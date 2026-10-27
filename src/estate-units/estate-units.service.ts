import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
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
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;

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

@Injectable()
export class EstateUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
  ) {}

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
      select: { id: true, organizationId: true, ownerId: true, isActive: true },
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

    const data: Prisma.EstateUnitUncheckedUpdateInput = { latitude, longitude };

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

    return this.prisma.$transaction(async (tx) => {
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
  }

  async endOccupancy(user: AuthUser, id: string, occupancyId: string) {
    const unit = await this.getUnitOrThrow(id);

    await this.assertEstateManager(user, unit.organizationId);

    const occupancy = await this.prisma.unitOccupancy.findFirst({
      where: { id: occupancyId, estateUnitId: unit.id },
      select: { id: true, endAt: true },
    });

    if (!occupancy) {
      throw new NotFoundException('Occupancy not found.');
    }

    const now = new Date();

    if (occupancy.endAt && occupancy.endAt <= now) {
      throw new BadRequestException('This occupancy has already ended.');
    }

    return this.prisma.unitOccupancy.update({
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
  }
}
