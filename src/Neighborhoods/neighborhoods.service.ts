import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateNeighborhoodDto,
  NeighborhoodQueryDto,
} from './dto/neighborhood.dto';

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
  constructor(private readonly prisma: PrismaService) {}

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
      throw new ForbiddenException('Only platform admins can add neighborhoods.');
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

  async join(userId: string, neighborhoodId: string, makePrimary = false) {
    const neighborhood = await this.prisma.neighborhood.findFirst({
      where: { id: neighborhoodId, isActive: true },
      select: { id: true },
    });

    if (!neighborhood) {
      throw new NotFoundException('Neighborhood not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const links = await tx.userNeighborhood.findMany({
        where: { userId },
        select: { neighborhoodId: true, isPrimary: true },
      });

      const existing = links.find((l) => l.neighborhoodId === neighborhoodId);

      if (!existing && links.length >= MAX_PER_USER) {
        throw new BadRequestException(
          `You can belong to at most ${MAX_PER_USER} neighborhoods.`,
        );
      }

      // The first neighborhood someone joins becomes their primary one.
      const primary = makePrimary || links.length === 0 || !links.some((l) => l.isPrimary);

      if (primary) {
        await tx.userNeighborhood.updateMany({
          where: { userId },
          data: { isPrimary: false },
        });
      }

      return tx.userNeighborhood.upsert({
        where: { userId_neighborhoodId: { userId, neighborhoodId } },
        create: { userId, neighborhoodId, isPrimary: primary },
        update: primary ? { isPrimary: true } : {},
        include: { neighborhood: true },
      });
    });
  }

  async setPrimary(userId: string, neighborhoodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.userNeighborhood.findUnique({
        where: { userId_neighborhoodId: { userId, neighborhoodId } },
      });

      if (!link) {
        throw new NotFoundException('You have not joined this neighborhood.');
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
        where: { userId_neighborhoodId: { userId, neighborhoodId } },
      });

      if (!link) return;

      await tx.userNeighborhood.delete({ where: { id: link.id } });

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
