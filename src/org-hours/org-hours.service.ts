import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HoursKind, OrganizationHours } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { HHMM, SetHoursDto } from './dto/set-hours.dto';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface HoursStatus {
  /** False when no hours were ever set. Unconfigured organizations count as open. */
  configured: boolean;
  isOpen: boolean;
  timezone: string;
  nextOpen: { dayOfWeek: number; day: string; time: string } | null;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Day of week and minutes since midnight in the organization's timezone. */
function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    day: WEEKDAY_INDEX[get('weekday')],
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

@Injectable()
export class OrgHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private assertTimezone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new BadRequestException(
        'Unknown timezone. Use an IANA name such as Africa/Lagos.',
      );
    }
  }

  private isOpenAt(
    byDay: Map<number, OrganizationHours>,
    day: number,
    minutes: number,
  ): boolean {
    const today = byDay.get(day);

    if (today && !today.isClosed) {
      const opens = toMinutes(today.opensAt);
      const closes = toMinutes(today.closesAt);
      const overnight = closes < opens;

      if (overnight ? minutes >= opens : minutes >= opens && minutes < closes) {
        return true;
      }
    }

    // A window that started yesterday and runs past midnight.
    const yesterday = byDay.get((day + 6) % 7);

    if (yesterday && !yesterday.isClosed) {
      const opens = toMinutes(yesterday.opensAt);
      const closes = toMinutes(yesterday.closesAt);

      if (closes < opens && minutes < closes) {
        return true;
      }
    }

    return false;
  }

  private nextOpen(
    byDay: Map<number, OrganizationHours>,
    day: number,
    minutes: number,
  ): HoursStatus['nextOpen'] {
    for (let offset = 0; offset <= 7; offset++) {
      const d = (day + offset) % 7;
      const row = byDay.get(d);

      if (!row || row.isClosed) continue;
      if (offset === 0 && toMinutes(row.opensAt) <= minutes) continue;

      return { dayOfWeek: d, day: DAY_NAMES[d], time: row.opensAt };
    }

    return null;
  }

  async status(
    organizationId: string,
    kind: HoursKind = HoursKind.OPENING,
    now: Date = new Date(),
  ): Promise<HoursStatus> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found.');
    }

    const rows = await this.prisma.organizationHours.findMany({
      where: { organizationId, kind },
    });

    if (rows.length === 0) {
      return {
        configured: false,
        isOpen: true,
        timezone: org.timezone,
        nextOpen: null,
      };
    }

    const byDay = new Map(rows.map((row) => [row.dayOfWeek, row]));
    const { day, minutes } = localParts(now, org.timezone);
    const isOpen = this.isOpenAt(byDay, day, minutes);

    return {
      configured: true,
      isOpen,
      timezone: org.timezone,
      nextOpen: isOpen ? null : this.nextOpen(byDay, day, minutes),
    };
  }

  /** Throws 400 when the organization is closed right now. */
  async assertOpen(
    organizationId: string,
    kind: HoursKind,
    closedLabel: string,
  ): Promise<void> {
    const status = await this.status(organizationId, kind);

    if (status.isOpen) return;

    const next = status.nextOpen
      ? ` Next opening: ${status.nextOpen.day} ${status.nextOpen.time}.`
      : '';

    throw new BadRequestException(`${closedLabel}.${next}`);
  }

  async get(organizationId: string, kind: HoursKind = HoursKind.OPENING) {
    const [hours, status] = await Promise.all([
      this.prisma.organizationHours.findMany({
        where: { organizationId, kind },
        orderBy: { dayOfWeek: 'asc' },
        select: {
          dayOfWeek: true,
          opensAt: true,
          closesAt: true,
          isClosed: true,
        },
      }),
      this.status(organizationId, kind),
    ]);

    return { kind, hours, status };
  }

  async setHours(user: AuthUser, organizationId: string, dto: SetHoursDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, type: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    await this.permissions.assert(user, organizationId, 'hours.manage');

    const kind = dto.kind ?? HoursKind.OPENING;

    if (kind === HoursKind.VISITING && organization.type !== 'ESTATE') {
      throw new BadRequestException('Visiting hours only apply to estates.');
    }

    if (dto.timezone) {
      this.assertTimezone(dto.timezone);
    }

    const seen = new Set<number>();
    const rows = dto.days.map((day) => {
      if (seen.has(day.dayOfWeek)) {
        throw new BadRequestException(`Day ${day.dayOfWeek} appears twice.`);
      }
      seen.add(day.dayOfWeek);

      if (day.isClosed) {
        return {
          organizationId,
          kind,
          dayOfWeek: day.dayOfWeek,
          opensAt: '00:00',
          closesAt: '00:00',
          isClosed: true,
        };
      }

      if (
        !day.opensAt ||
        !day.closesAt ||
        !HHMM.test(day.opensAt) ||
        !HHMM.test(day.closesAt)
      ) {
        throw new BadRequestException(
          `Day ${day.dayOfWeek} needs opensAt and closesAt in HH:mm, or isClosed: true.`,
        );
      }

      if (day.opensAt === day.closesAt) {
        throw new BadRequestException(
          `Day ${day.dayOfWeek}: opensAt and closesAt cannot be equal. Use 00:00 to 23:59 for all day.`,
        );
      }

      return {
        organizationId,
        kind,
        dayOfWeek: day.dayOfWeek,
        opensAt: day.opensAt,
        closesAt: day.closesAt,
        isClosed: false,
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationHours.deleteMany({
        where: { organizationId, kind },
      });

      if (rows.length > 0) {
        await tx.organizationHours.createMany({ data: rows });
      }

      if (dto.timezone) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { timezone: dto.timezone },
        });
      }
    });

    return this.get(organizationId, kind);
  }

  /** Manual pause switch for shops, independent of the weekly schedule. */
  async setAcceptingOrders(
    user: AuthUser,
    organizationId: string,
    accepting: boolean,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    if (organization.type !== 'SHOP') {
      throw new BadRequestException('Only shops take orders.');
    }

    await this.permissions.assert(user, organizationId, 'hours.manage');

    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { acceptingOrders: accepting },
      select: { id: true, acceptingOrders: true },
    });
  }
}