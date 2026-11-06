
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateNeighborhoodDto,
  NeighborhoodQueryDto,
} from './dto/neighborhood.dto';

import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { neighborhoodWelcomeTemplate } from '../mail/templates';

const MAX_PER_USER = 5;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-');

@Injectable()
export class NeighborhoodsService {
  private readonly logger = new Logger(NeighborhoodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
  ) {}

  search(query: NeighborhoodQueryDto) {
    const q = query.q?.trim();

    return this.prisma.neighborhood.findMany({
      where: {
        isActive: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        ...(query.city
          ? { city: { equals: query.city.trim(), mode: 'insensitive' } }
          : {}),
        ...(query.state
          ? { state: { equals: query.state.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ state: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      take: 50,
    });
  }

  /** Only platform super admins add neighborhoods. */
  async create(user: AuthUser, dto: CreateNeighborhoodDto) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException(
        'Only platform admins can add neighborhoods.',
      );
    }

    try {
      return await this.prisma.neighborhood.create({
        data: {
          name: dto.name.trim(),
          city: dto.city.trim(),
          state: dto.state.trim(),
          slug: slugify(`${dto.name} ${dto.city}`),
          description: dto.description?.trim(),
          postalCode: dto.postalCode?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A neighborhood with this name already exists in that city.',
        );
      }

      throw error;
    }
  }

  mine(userId: string) {
    return this.prisma.userNeighborhood.findMany({
      where: { userId },
      include: { neighborhood: true },
      orderBy: [{ isPrimary: 'desc' }, { joinedAt: 'asc' }],
    });
  }

  private getDisplayName(user: {
    firstName?: string | null;
    otherNames?: string | null;
    lastName?: string | null;
  }): string {
    return [
      user.firstName,
      user.otherNames,
      user.lastName,
    ]
      .filter((part) => part?.trim())
      .join(' ')
      .trim();
  }

  private async sendWelcomeEmail(
    email: string | null | undefined,
    recipientName: string,
    neighborhood: {
      name: string;
      city: string;
      state: string;
    },
  ): Promise<void> {
    if (!email) return;

    try {
      const html = this.mailTemplates.render(
        neighborhoodWelcomeTemplate,
        {
          recipientName: recipientName || undefined,
          neighborhoodName: neighborhood.name,
          city: neighborhood.city,
          state: neighborhood.state,
        },
      );

      await this.mail.send(
        email,
        `Welcome to ${neighborhood.name} on AdugboHub`,
        html,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown email error';

      this.logger.error(
        `Neighborhood welcome email failed: ${message}`,
      );
    }
  }

  async join(
    userId: string,
    neighborhoodId: string,
    makePrimary = false,
  ) {
    const neighborhood = await this.prisma.neighborhood.findFirst({
      where: { id: neighborhoodId, isActive: true },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
      },
    });

    if (!neighborhood) {
      throw new NotFoundException('Neighborhood not found.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const links = await tx.userNeighborhood.findMany({
        where: { userId },
        select: {
          neighborhoodId: true,
          isPrimary: true,
        },
      });

      const existing = links.find(
        (link) => link.neighborhoodId === neighborhoodId,
      );

      if (!existing && links.length >= MAX_PER_USER) {
        throw new BadRequestException(
          `You can belong to at most ${MAX_PER_USER} neighborhoods.`,
        );
      }

      // The first neighborhood someone joins becomes their primary one.
      const primary =
        makePrimary ||
        links.length === 0 ||
        !links.some((link) => link.isPrimary);

      if (primary) {
        await tx.userNeighborhood.updateMany({
          where: { userId },
          data: { isPrimary: false },
        });
      }

      const membership = await tx.userNeighborhood.upsert({
        where: {
          userId_neighborhoodId: {
            userId,
            neighborhoodId,
          },
        },
        create: {
          userId,
          neighborhoodId,
          isPrimary: primary,
        },
        update: primary ? { isPrimary: true } : {},
        include: {
          neighborhood: true,
        },
      });

      return {
        membership,
        isNewMembership: !existing,
      };
    });

    // Send the welcome email only for a first-time membership.
    // Email failure must not undo a successful join.
    if (result.isNewMembership) {
      try {
        const resident = await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            email: true,
            firstName: true,
            otherNames: true,
            lastName: true,
          },
        });

        if (resident) {
          await this.sendWelcomeEmail(
            resident.email,
            this.getDisplayName(resident),
            neighborhood,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(
          `Could not prepare neighborhood welcome email: ${message}`,
        );
      }
    }

    return result.membership;
  }

  async setPrimary(userId: string, neighborhoodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.userNeighborhood.findUnique({
        where: {
          userId_neighborhoodId: {
            userId,
            neighborhoodId,
          },
        },
      });

      if (!link) {
        throw new NotFoundException(
          'You have not joined this neighborhood.',
        );
      }

      await tx.userNeighborhood.updateMany({
        where: { userId },
        data: { isPrimary: false },
      });

      return tx.userNeighborhood.update({
        where: { id: link.id },
        data: { isPrimary: true },
        include: { neighborhood: true },
      });
    });
  }

  async leave(userId: string, neighborhoodId: string) {
    await this.prisma.$transaction(async (tx) => {
      const link = await tx.userNeighborhood.findUnique({
        where: {
          userId_neighborhoodId: {
            userId,
            neighborhoodId,
          },
        },
      });

      if (!link) return;

      await tx.userNeighborhood.delete({
        where: { id: link.id },
      });

      // If the primary one was removed, promote the oldest remaining.
      if (link.isPrimary) {
        const next = await tx.userNeighborhood.findFirst({
          where: { userId },
          orderBy: { joinedAt: 'asc' },
        });

        if (next) {
          await tx.userNeighborhood.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }
    });

    return { ok: true };
  }
}
