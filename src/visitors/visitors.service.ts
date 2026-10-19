
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipRole,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { createHash, randomInt } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreatePassDto, VerifyPassDto } from './dto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const hashCode = (code: string): string =>
  createHash('sha256').update(code).digest('hex');

@Injectable()
export class VisitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
  ) {}

  private async assertEstateStaff(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const organization = await this.orgs.getOrThrow(organizationId);

    if (organization.type !== 'ESTATE') {
      throw new BadRequestException(
        'Visitor passes are only available for estates.',
      );
    }

    const roles: MembershipRole[] = [
      MembershipRole.RESIDENT,
      MembershipRole.ORG_ADMIN,
      MembershipRole.ORG_OWNER,
      MembershipRole.SECURITY,
    ];

    await this.orgs.assertRole(userId, organizationId, roles);
  }

  async create(hostId: string, dto: CreatePassDto) {
    await this.assertEstateStaff(hostId, dto.organizationId);

    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);

    if (
      Number.isNaN(validFrom.getTime()) ||
      Number.isNaN(validUntil.getTime()) ||
      validUntil <= validFrom
    ) {
      throw new BadRequestException(
        'validUntil must be a valid date after validFrom.',
      );
    }

    const maxEntries = dto.maxEntries ?? 1;

    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new BadRequestException(
        'maxEntries must be a positive integer.',
      );
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const codeHash = hashCode(code);

      try {
        const pass = await this.prisma.visitorPass.create({
          data: {
            codeHash,
            organizationId: dto.organizationId,
            hostId,
            visitorName: dto.visitorName.trim(),
            visitorPhone: dto.visitorPhone?.trim(),
            purpose: dto.purpose?.trim(),
            validFrom,
            validUntil,
            maxEntries,
          },
        });

        // Return the readable code only when the pass is created.
        // Never return the stored hash.
        return { ...pass, code };
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Retry if the generated code collides with an existing codeHash.
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException(
      'Could not generate a unique visitor pass. Please try again.',
    );
  }

  async mine(hostId: string) {
    return this.prisma.visitorPass.findMany({
      where: { hostId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      // codeHash is not returned to the client.
      omit: { codeHash: true },
    });
  }

  async revoke(hostId: string, id: string) {
    const pass = await this.prisma.visitorPass.findFirst({
      where: { id, hostId },
    });

    if (!pass) {
      throw new NotFoundException('Pass not found.');
    }

    if (pass.status === 'REVOKED') {
      throw new BadRequestException('This pass has already been revoked.');
    }

    if (pass.status === 'COMPLETED') {
      throw new BadRequestException('A completed pass cannot be revoked.');
    }

    return this.prisma.visitorPass.update({
      where: { id },
      data: { status: 'REVOKED' },
      omit: { codeHash: true },
    });
  }

  async verify(securityId: string, dto: VerifyPassDto) {
    await this.assertEstateStaff(securityId, dto.organizationId);

    const code = dto.code.trim().toUpperCase();

    const pass = await this.prisma.visitorPass.findFirst({
      where: {
        codeHash: hashCode(code),
        organizationId: dto.organizationId,
      },
      include: {
        host: {
          select: {
            id: true,
            fullName: true,
            phone: true,
          },
        },
      },
    });

    if (!pass) {
      throw new NotFoundException('Invalid visitor pass code.');
    }

    const now = new Date();

    if (pass.status === 'REVOKED') {
      throw new BadRequestException('This pass was revoked.');
    }

    if (pass.status === 'COMPLETED' || pass.entriesUsed >= pass.maxEntries) {
      throw new BadRequestException('This pass has already been used.');
    }

    if (now < pass.validFrom) {
      throw new BadRequestException('This pass is not valid yet.');
    }

    if (now > pass.validUntil) {
      await this.prisma.visitorPass.update({
        where: { id: pass.id },
        data: { status: 'EXPIRED' },
      });

      throw new BadRequestException('This pass has expired.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional update prevents two simultaneous scans from consuming
      // the same remaining entry.
      const updatedCount = await tx.visitorPass.updateMany({
        where: {
          id: pass.id,
          entriesUsed: pass.entriesUsed,
          status: { notIn: ['REVOKED', 'COMPLETED', 'EXPIRED'] },
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
        data: {
          entriesUsed: { increment: 1 },
          status:
            pass.entriesUsed + 1 >= pass.maxEntries
              ? 'COMPLETED'
              : 'ACTIVE',
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictException(
          'The pass has changed or has already been used. Please scan again.',
        );
      }

      const updatedPass = await tx.visitorPass.findUniqueOrThrow({
        where: { id: pass.id },
        omit: { codeHash: true },
      });

      await tx.gateLog.create({
        data: {
          organizationId: pass.organizationId,
          passId: pass.id,
          securityId,
          action: 'ENTRY',
          visitorName: pass.visitorName,
        },
      });

      await tx.notification.create({
        data: {
          userId: pass.hostId,
          title: 'Visitor arrived',
          body: `${pass.visitorName} has been admitted at the gate.`,
        },
      });

      return updatedPass;
    });

    return {
      valid: true,
      visitorName: pass.visitorName,
      purpose: pass.purpose,
      host: pass.host,
      pass: result,
    };
  }

  async exit(securityId: string, dto: VerifyPassDto) {
    await this.assertEstateStaff(securityId, dto.organizationId);

    const pass = await this.prisma.visitorPass.findFirst({
      where: {
        codeHash: hashCode(dto.code.trim().toUpperCase()),
        organizationId: dto.organizationId,
      },
    });

    if (!pass) {
      throw new NotFoundException('Invalid visitor pass code.');
    }

    await this.prisma.gateLog.create({
      data: {
        organizationId: pass.organizationId,
        passId: pass.id,
        securityId,
        action: 'EXIT',
        visitorName: pass.visitorName,
      },
    });

    return {
      ok: true,
      visitorName: pass.visitorName,
    };
  }

  async gateLog(userId: string, organizationId: string) {
    await this.assertEstateStaff(userId, organizationId);

    return this.prisma.gateLog.findMany({
      where: { organizationId },
      include: {
        pass: {
          select: {
            visitorName: true,
            host: {
              select: { id: true, fullName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
