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
import { OrganizationsService } from '../organizations/organizations.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';

import {
  AddOccupantDto,
  CreateUnitDto,
  ListUnitsQueryDto,
  PinUnitLocationDto,
  UpdateUnitDto,
} from './dto';

import { RouteLineString } from './dto/is-route-line-string.validator';

/** Rejects pins that are obviously wrong (typos, wrong city, 0,0). */
const MAX_PIN_DISTANCE_KM = 10;
const EARTH_RADIUS_KM = 6371;

const toNumber = (value: Prisma.Decimal | null | undefined): number | null =>
  value == null ? null : Number(value);

const round = (value: number, places: number): number =>
  Number(value.toFixed(places));

const distanceKm = (
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number => {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) *
      Math.cos(rad(bLat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

/** An occupancy that has started and has not ended yet. */
const activeOccupancy = (now: Date): Prisma.UnitOccupancyWhereInput => ({
  startAt: { lte: now },
  OR: [{ endAt: null }, { endAt: { gt: now } }],
});

const PERSON_SELECT = {
  id: true,
  firstName: true,
  otherNames: true,
  lastName: true,
  phone: true,
  email: true,
} satisfies Prisma.UserSelect;

const unitInclude = (now: Date) =>
  ({
    owner: { select: PERSON_SELECT },
    occupancies: {
      where: activeOccupancy(now),
      select: {
        id: true,
        isPrimary: true,
        startAt: true,
        endAt: true,
        user: { select: PERSON_SELECT },
      },
      orderBy: { startAt: 'asc' as const },
    },
  }) satisfies Prisma.EstateUnitInclude;

/** Prisma Decimals serialize to strings; the API returns plain numbers. */
const present = <
  T extends {
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  },
>(
  unit: T,
) => ({
  ...unit,
  latitude: toNumber(unit.latitude),
  longitude: toNumber(unit.longitude),
});

/** Rebuild the route from validated values so nothing else gets stored. */
const sanitizeRoute = (route: RouteLineString): Prisma.InputJsonValue => ({
  type: 'LineString',
  coordinates: route.coordinates.map(([lng, lat]) => [
    round(lng, 6),
    round(lat, 6),
  ]),
});

/** Escape dynamic values before inserting them into HTML emails. */
const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );

@Injectable()
export class EstateUnitsService {
  private readonly logger = new Logger(EstateUnitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Sends a branded unit notification.
   *
   * Email errors are intentionally isolated from database operations.
   */
  private async sendUnitEmail(
    recipients: Array<string | null | undefined>,
    subject: string,
    heading: string,
    message: string,
    details: {
      estateName?: string | null;
      unitNumber?: string | null;
      building?: string | null;
      unitType?: string | null;
    },
  ): Promise<void> {
    const emails = [
      ...new Set(
        recipients
          .filter((email): email is string => Boolean(email?.trim()))
          .map((email) => email.trim().toLowerCase()),
      ),
    ];

    if (!emails.length) {
      return;
    }

    const detailRows = [
      ['Estate', details.estateName],
      ['Unit number', details.unitNumber],
      ['Building', details.building],
      ['Unit type', details.unitType],
    ]
      .filter(([, value]) => Boolean(value))
      .map(
        ([label, value]) => `
          <tr>
            <td style="padding:10px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">
              ${escapeHtml(label)}
            </td>
            <td style="padding:10px 12px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #f1f5f9;">
              ${escapeHtml(value)}
            </td>
          </tr>
        `,
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${escapeHtml(subject)}</title>
        </head>

        <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:14px;overflow:hidden;">
                  <tr>
                    <td style="padding:26px 30px;background:#6d28d9;">
                      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">
                        AdugboHub
                      </h1>
                      <p style="margin:6px 0 0;color:#ede9fe;font-size:13px;">
                        Your neighbourhood, better connected.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:32px 30px;">
                      <h2 style="margin:0 0 14px;color:#1e293b;font-size:21px;">
                        ${escapeHtml(heading)}
                      </h2>

                      <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.7;">
                        ${escapeHtml(message)}
                      </p>

                      ${
                        detailRows
                          ? `
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:9px;border-collapse:separate;border-spacing:0;margin-bottom:24px;">
                              ${detailRows}
                            </table>
                          `
                          : ''
                      }

                      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">
                        If you have questions about this update, please contact your estate management.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:20px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                      <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
                        This is an automated notification from AdugboHub.
                        Please do not reply directly to this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    await Promise.all(
      emails.map(async (email) => {
        try {
          await this.mail.send(email, subject, html);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown email error';

          this.logger.error(
            `Unable to send estate unit email to ${email}: ${message}`,
          );
        }
      }),
    );
  }

  /** Gets the email addresses of the owner and current occupants. */
  private async getUnitNotificationEmails(
    unitId: string,
  ): Promise<string[]> {
    const unit = await this.prisma.estateUnit.findUnique({
      where: { id: unitId },
      select: {
        owner: {
          select: { email: true },
        },
        occupancies: {
          where: activeOccupancy(new Date()),
          select: {
            user: {
              select: { email: true },
            },
          },
        },
      },
    });

    if (!unit) {
      return [];
    }

    return [
      unit.owner?.email,
      ...unit.occupancies.map((occupancy) => occupancy.user.email),
    ].filter((email): email is string => Boolean(email));
  }

  /** Gets the estate name for email notifications. */
  private async getEstateName(organizationId: string): Promise<string> {
    const organization = await this.orgs.getOrThrow(organizationId);
    return organization.name;
  }

  /** Builds common unit details for email notifications. */
  private getUnitEmailDetails(
    unit: {
      unitNumber: string;
      building: string | null;
      unitType: string | null;
    },
    estateName: string,
  ) {
    return {
      estateName,
      unitNumber: unit.unitNumber,
      building: unit.building,
      unitType: unit.unitType,
    };
  }

  /** The organization must be an estate and the user must hold unit.manage. */
  private async assertEstateManager(
    user: AuthUser,
    organizationId: string,
  ): Promise<void> {
    const organization = await this.orgs.getOrThrow(organizationId);

    if (organization.type !== 'ESTATE') {
      throw new BadRequestException('Units are only available for estates.');
    }

    await this.permissions.assert(user, organizationId, 'unit.manage');
  }

  private async isApprovedMember(
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId, status: 'APPROVED' },
      select: { id: true },
    });

    return membership !== null;
  }

  private async assertApprovedMember(
    organizationId: string,
    userId: string,
    message: string,
  ): Promise<void> {
    if (!(await this.isApprovedMember(organizationId, userId))) {
      throw new BadRequestException(message);
    }
  }

  private async getUnitOrThrow(id: string) {
    const unit = await this.prisma.estateUnit.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        ownerId: true,
        isActive: true,
        unitNumber: true,
        building: true,
        unitType: true,
      },
    });

    if (!unit) {
      throw new NotFoundException('Unit not found.');
    }

    return unit;
  }

  private mapWriteError(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(
        'A unit with this number already exists in this estate.',
      );
    }

    return error;
  }

  /**
   * Residents (owner or current occupant, with an approved membership) can
   * manage their own unit's pin. Anyone else needs unit.manage.
   */
  private async assertCanPin(
    user: AuthUser,
    unit: { id: string; organizationId: string; ownerId: string | null },
  ): Promise<void> {
    let isResident = unit.ownerId === user.id;

    if (!isResident) {
      const occupancy = await this.prisma.unitOccupancy.findFirst({
        where: {
          estateUnitId: unit.id,
          userId: user.id,
          ...activeOccupancy(new Date()),
        },
        select: { id: true },
      });

      isResident = occupancy !== null;
    }

    if (isResident) {
      if (!(await this.isApprovedMember(unit.organizationId, user.id))) {
        throw new ForbiddenException(
          'Your membership in this estate is not active.',
        );
      }

      return;
    }

    await this.permissions.assert(user, unit.organizationId, 'unit.manage');
  }

  async create(user: AuthUser, dto: CreateUnitDto) {
    await this.assertEstateManager(user, dto.organizationId);

    if (dto.ownerId) {
      await this.assertApprovedMember(
        dto.organizationId,
        dto.ownerId,
        'The owner must be an approved member of this estate.',
      );
    }

    try {
      const unit = await this.prisma.estateUnit.create({
        data: {
          organizationId: dto.organizationId,
          unitNumber: dto.unitNumber,
          building: dto.building || null,
          unitType: dto.unitType || null,
          ownerId: dto.ownerId ?? null,
        },
        include: unitInclude(new Date()),
      });

      // Notify the owner when a unit is assigned during creation.
      if (unit.owner?.email) {
        const estateName = await this.getEstateName(dto.organizationId);

        await this.sendUnitEmail(
          [unit.owner.email],
          'A unit has been assigned to you',
          'Your estate unit has been created',
          `A unit has been created and assigned to you in ${estateName}.`,
          this.getUnitEmailDetails(unit, estateName),
        );
      }

      return present(unit);
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async listByOrganization(
    user: AuthUser,
    organizationId: string,
    query: ListUnitsQueryDto,
  ) {
    await this.assertEstateManager(user, organizationId);

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.estateUnit.findMany({
        where: { organizationId },
        include: unitInclude(new Date()),
        orderBy: [{ building: 'asc' }, { unitNumber: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.estateUnit.count({ where: { organizationId } }),
    ]);

    return { items: items.map(present), total, limit, offset };
  }

  /** Units the signed-in user owns or currently lives in. */
  async mine(userId: string) {
    const now = new Date();

    const units = await this.prisma.estateUnit.findMany({
      where: {
        isActive: true,
        OR: [
          { ownerId: userId },
          { occupancies: { some: { userId, ...activeOccupancy(now) } } },
        ],
      },
      select: {
        id: true,
        organizationId: true,
        unitNumber: true,
        building: true,
        unitType: true,
        latitude: true,
        longitude: true,
        directions: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ organizationId: 'asc' }, { unitNumber: 'asc' }],
      take: 100,
    });

    return units.map(present);
  }

  async update(user: AuthUser, id: string, dto: UpdateUnitDto) {
    const unit = await this.getUnitOrThrow(id);

    await this.assertEstateManager(user, unit.organizationId);

    const data: Prisma.EstateUnitUncheckedUpdateInput = {};

    if (dto.unitNumber != null) data.unitNumber = dto.unitNumber;
    if (dto.building !== undefined) data.building = dto.building || null;
    if (dto.unitType !== undefined) data.unitType = dto.unitType || null;
    if (dto.isActive != null) data.isActive = dto.isActive;

    if (dto.ownerId !== undefined) {
      if (dto.ownerId) {
        await this.assertApprovedMember(
          unit.organizationId,
          dto.ownerId,
          'The owner must be an approved member of this estate.',
        );
      }

      data.ownerId = dto.ownerId || null;
    }

    try {
      const updated = await this.prisma.estateUnit.update({
        where: { id },
        data,
        include: unitInclude(new Date()),
      });

      const estateName = await this.getEstateName(unit.organizationId);

      // Notify the newly assigned owner.
      if (
        dto.ownerId &&
        dto.ownerId !== unit.ownerId &&
        updated.owner?.email
      ) {
        await this.sendUnitEmail(
          [updated.owner.email],
          'A unit has been assigned to you',
          'You have been assigned an estate unit',
          `You have been assigned a unit in ${estateName}.`,
          this.getUnitEmailDetails(updated, estateName),
        );
      }

      // Notify the owner and current occupants when unit availability changes.
      if (
        dto.isActive !== undefined &&
        dto.isActive !== unit.isActive
      ) {
        const recipients = await this.getUnitNotificationEmails(id);

        await this.sendUnitEmail(
          recipients,
          dto.isActive ? 'Your estate unit is now active' : 'Your estate unit has been deactivated',
          dto.isActive ? 'Your unit is now active' : 'Your unit has been deactivated',
          dto.isActive
            ? `Your unit in ${estateName} has been reactivated.`
            : `Your unit in ${estateName} has been deactivated. Please contact estate management if you need further information.`,
          this.getUnitEmailDetails(updated, estateName),
        );
      }

      return present(updated);
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async setLocation(user: AuthUser, id: string, dto: PinUnitLocationDto) {
    const unit = await this.prisma.estateUnit.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        ownerId: true,
        isActive: true,
        organization: {
          select: { type: true, latitude: true, longitude: true },
        },
      },
    });

    if (!unit) {
      throw new NotFoundException('Unit not found.');
    }

    if (unit.organization.type !== 'ESTATE') {
      throw new BadRequestException('Units are only available for estates.');
    }

    if (!unit.isActive) {
      throw new BadRequestException('This unit is not active.');
    }

    await this.assertCanPin(user, unit);

    const latitude = round(dto.latitude, 7);
    const longitude = round(dto.longitude, 7);

    // Sanity check against the estate's own pin, when it has one.
    const estateLat = toNumber(unit.organization.latitude);
    const estateLng = toNumber(unit.organization.longitude);

    if (estateLat != null && estateLng != null) {
      const km = distanceKm(estateLat, estateLng, latitude, longitude);

      if (km > MAX_PIN_DISTANCE_KM) {
        throw new BadRequestException(
          'That pin is too far from the estate. Check the location and try again.',
        );
      }
    }

    const data: Prisma.EstateUnitUncheckedUpdateInput = {
      latitude,
      longitude,
    };

    if (dto.directions !== undefined) {
      data.directions = dto.directions || null;
    }

    if (dto.routeGeoJson === null) {
      data.routeGeoJson = Prisma.JsonNull;
    } else if (dto.routeGeoJson !== undefined) {
      data.routeGeoJson = sanitizeRoute(dto.routeGeoJson);
    }

    const updated = await this.prisma.estateUnit.update({
      where: { id },
      data,
      include: unitInclude(new Date()),
    });

    return present(updated);
  }

  /**
   * Removes the pin, the written directions and the route.
   * Passes that were set to share directions will stop returning a map.
   */
  async clearLocation(user: AuthUser, id: string) {
    const unit = await this.getUnitOrThrow(id);

    await this.assertCanPin(user, unit);

    const updated = await this.prisma.estateUnit.update({
      where: { id },
      data: {
        latitude: null,
        longitude: null,
        directions: null,
        routeGeoJson: Prisma.JsonNull,
      },
      include: unitInclude(new Date()),
    });

    return present(updated);
  }

  async addOccupant(user: AuthUser, id: string, dto: AddOccupantDto) {
    const unit = await this.getUnitOrThrow(id);

    await this.assertEstateManager(user, unit.organizationId);

    if (!unit.isActive) {
      throw new BadRequestException('This unit is not active.');
    }

    await this.assertApprovedMember(
      unit.organizationId,
      dto.userId,
      'The occupant must be an approved member of this estate.',
    );

    const now = new Date();

    const occupancy = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.unitOccupancy.findFirst({
        where: {
          estateUnitId: unit.id,
          userId: dto.userId,
          ...activeOccupancy(now),
        },
        select: { id: true },
      });

      if (existing) {
        throw new ConflictException('This person already lives in this unit.');
      }

      if (dto.isPrimary) {
        await tx.unitOccupancy.updateMany({
          where: {
            estateUnitId: unit.id,
            isPrimary: true,
            ...activeOccupancy(now),
          },
          data: { isPrimary: false },
        });
      }

      return tx.unitOccupancy.create({
        data: {
          estateUnitId: unit.id,
          userId: dto.userId,
          isPrimary: dto.isPrimary ?? false,
        },
        select: {
          id: true,
          isPrimary: true,
          startAt: true,
          endAt: true,
          user: { select: PERSON_SELECT },
        },
      });
    });

    // Notify the newly added occupant after the transaction succeeds.
    if (occupancy.user.email) {
      const estateName = await this.getEstateName(unit.organizationId);

      await this.sendUnitEmail(
        [occupancy.user.email],
        'You have been added as an estate occupant',
        'Welcome to your new unit',
        `You have been added as an occupant of a unit in ${estateName}.`,
        this.getUnitEmailDetails(unit, estateName),
      );
    }

    return occupancy;
  }

  async endOccupancy(user: AuthUser, id: string, occupancyId: string) {
    const unit = await this.getUnitOrThrow(id);

    await this.assertEstateManager(user, unit.organizationId);

    const occupancy = await this.prisma.unitOccupancy.findFirst({
      where: { id: occupancyId, estateUnitId: unit.id },
      select: {
        id: true,
        endAt: true,
        user: { select: PERSON_SELECT },
      },
    });

    if (!occupancy) {
      throw new NotFoundException('Occupancy not found.');
    }

    const now = new Date();

    if (occupancy.endAt && occupancy.endAt <= now) {
      throw new BadRequestException('This occupancy has already ended.');
    }

    const updated = await this.prisma.unitOccupancy.update({
      where: { id: occupancy.id },
      data: { endAt: now, isPrimary: false },
      select: {
        id: true,
        isPrimary: true,
        startAt: true,
        endAt: true,
        user: { select: PERSON_SELECT },
      },
    });

    // Notify the former occupant after the update succeeds.
    if (updated.user.email) {
      const estateName = await this.getEstateName(unit.organizationId);

      await this.sendUnitEmail(
        [updated.user.email],
        'Your estate occupancy has ended',
        'Your occupancy has ended',
        `Your occupancy of a unit in ${estateName} has been marked as ended by estate management.`,
        this.getUnitEmailDetails(unit, estateName),
      );
    }

    return updated;
  }
}