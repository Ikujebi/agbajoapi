import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrgHoursService } from '../org-hours/org-hours.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { Permission } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreatePassDto, VerifyPassDto } from './dto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const hashCode = (code: string): string =>
  createHash('sha256').update(code).digest('hex');

@Injectable()
export class VisitorsService {
  private readonly log = new Logger(VisitorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
    private readonly hours: OrgHoursService,
  ) {}

  /**
   * Verify the organization is an estate and the user holds the permission.
   */
  private async assertEstate(
    user: AuthUser,
    organizationId: string,
    permission: Permission,
  ): Promise<void> {
    const organization = await this.orgs.getOrThrow(organizationId);

    if (organization.type !== 'ESTATE') {
      throw new BadRequestException(
        'Visitor passes are only available for estates.',
      );
    }

    await this.permissions.assert(user, organizationId, permission);
  }

  async create(user: AuthUser, dto: CreatePassDto) {
    await this.assertEstate(user, dto.organizationId, 'visitor.create');

    const hostId = user.id;
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
      throw new BadRequestException('maxEntries must be a positive integer.');
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
            createdById: hostId,
            visitorName: dto.visitorName.trim(),
            visitorPhone: dto.visitorPhone?.trim(),
            purpose: dto.purpose?.trim(),
            validFrom,
            validUntil,
            maxEntries,
          },
          omit: { codeHash: true },
        });

        // The readable code is returned only once, at creation.
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
      data: { status: 'REVOKED', revokedAt: new Date() },
      omit: { codeHash: true },
    });
  }

  async verify(user: AuthUser, dto: VerifyPassDto) {
    await this.assertEstate(user, dto.organizationId, 'visitor.verify');

    // Entry is only allowed during the estate's visiting hours.
    await this.hours.assertOpen(
      dto.organizationId,
      'VISITING',
      'Visitors cannot be admitted outside visiting hours',
    );

    const securityId = user.id;
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
            pass.entriesUsed + 1 >= pass.maxEntries ? 'COMPLETED' : 'ACTIVE',
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
          type: 'VISITOR_PASS',
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

  async exit(user: AuthUser, dto: VerifyPassDto) {
    // Exit is always allowed, even outside visiting hours.
    await this.assertEstate(user, dto.organizationId, 'visitor.verify');

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
        securityId: user.id,
        action: 'EXIT',
        visitorName: pass.visitorName,
      },
    });

    return {
      ok: true,
      visitorName: pass.visitorName,
    };
  }

  async gateLog(user: AuthUser, organizationId: string) {
    await this.assertEstate(user, organizationId, 'gate.view');

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

  /**
   * Marks passes whose validity window has ended as EXPIRED.
   * Needs ScheduleModule.forRoot() in AppModule.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireStalePasses(): Promise<void> {
    try {
      const result = await this.prisma.visitorPass.updateMany({
        where: { status: 'ACTIVE', validUntil: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });

      if (result.count > 0) {
        this.log.log(`Expired ${result.count} visitor pass(es)`);
      }
    } catch (error) {
      this.log.error(
        `Failed to expire visitor passes: ${(error as Error).message}`,
      );
    }
  }
}