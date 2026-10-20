
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SosStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { TriggerSosDto } from './dto/trigger-sos.dto';

@Injectable()
export class SosService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async trigger(
    user: AuthUser,
    organizationId: string,
    dto: TriggerSosDto,
  ) {
    const hasLatitude = dto.latitude !== undefined;
    const hasLongitude = dto.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'Latitude and longitude must be provided together.',
      );
    }

    // Confirm that the organization exists.
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    // Only approved members or superadmins may trigger an SOS.
    if (!user.isSuperAdmin) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId,
          },
        },
        select: { status: true },
      });

      if (membership?.status !== 'APPROVED') {
        throw new ForbiddenException(
          'You must be an approved member of this organization to trigger an SOS.',
        );
      }
    }

    const message = dto.message?.trim() || undefined;

    const alert = await this.prisma.sosAlert.create({
      data: {
        organizationId,
        userId: user.id,
        message,
        latitude:
          dto.latitude === undefined
            ? undefined
            : new Prisma.Decimal(dto.latitude),
        longitude:
          dto.longitude === undefined
            ? undefined
            : new Prisma.Decimal(dto.longitude),
        status: SosStatus.OPEN,
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
        createdAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
      },
    });

    return {
      message: 'SOS alert recorded successfully.',
      alert,
    };
  }
}
