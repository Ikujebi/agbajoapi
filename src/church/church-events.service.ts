import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../common/permissions/permissions.service";
import { AuthUser } from "../common/decorators/current-user.decorator";
import { NotificationsService } from "../notifications/notifications.service";
import { ChurchAccessService } from "./church-access.service";
import {
  CreateEventDto,
  MarkAttendanceDto,
  UpdateEventDto,
} from "./dto/church.dto";

/** Events without an end time count as running for this long. */
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class ChurchEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly access: ChurchAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is not a valid date.`);
    }

    return date;
  }

  private async approvedMemberIds(
    organizationId: string,
    excludeUserId?: string,
  ): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: "APPROVED",
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      select: { userId: true },
    });

    return rows.map((row) => row.userId);
  }

  private async announce(
    event: {
      id: string;
      organizationId: string;
      title: string;
      startsAt: Date;
    },
    actorId: string,
  ) {
    await this.notifications.send(
      await this.approvedMemberIds(event.organizationId, actorId),
      {
        type: "EVENT",
        title: `New event: ${event.title}`,
        body: `Starts ${event.startsAt.toUTCString()}`,
        data: {
          eventId: event.id,
          organizationId: event.organizationId,
          startsAt: event.startsAt.toISOString(),
        },
      },
    );
  }

  async create(user: AuthUser, organizationId: string, dto: CreateEventDto) {
    await this.permissions.assert(user, organizationId, "event.manage");

    const status = dto.status ?? EventStatus.DRAFT;

    if (status === EventStatus.CANCELLED || status === EventStatus.COMPLETED) {
      throw new BadRequestException(
        "A new event must be a draft or published.",
      );
    }

    const startsAt = this.parseDate(dto.startsAt, "startsAt");
    const endsAt = dto.endsAt
      ? this.parseDate(dto.endsAt, "endsAt")
      : undefined;

    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException("endsAt must be after startsAt.");
    }

    const event = await this.prisma.event.create({
      data: {
        organizationId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        location: dto.location?.trim(),
        startsAt,
        endsAt,
        capacity: dto.capacity,
        status,
      },
    });

    if (status === EventStatus.PUBLISHED) {
      await this.announce(event, user.id);
    }

    return event;
  }

  async update(user: AuthUser, id: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    await this.permissions.assert(user, event.organizationId, "event.manage");

    if (event.status === "CANCELLED" || event.status === "COMPLETED") {
      throw new BadRequestException("A closed event cannot be edited.");
    }

    if (dto.status === "DRAFT" && event.status !== "DRAFT") {
      throw new BadRequestException(
        "A published event cannot go back to draft.",
      );
    }

    const startsAt = dto.startsAt
      ? this.parseDate(dto.startsAt, "startsAt")
      : event.startsAt;
    const endsAt = dto.endsAt
      ? this.parseDate(dto.endsAt, "endsAt")
      : event.endsAt;

    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException("endsAt must be after startsAt.");
    }

    if (
      dto.capacity !== undefined &&
      dto.capacity < event._count.registrations
    ) {
      throw new BadRequestException(
        `Capacity cannot be lower than the ${event._count.registrations} people already registered.`,
      );
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.location !== undefined
          ? { location: dto.location.trim() }
          : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    if (dto.status === "PUBLISHED" && event.status !== "PUBLISHED") {
      await this.announce(updated, user.id);
    }

    if (dto.status === "CANCELLED") {
      const registrants = await this.prisma.eventRegistration.findMany({
        where: { eventId: id },
        select: { userId: true },
      });

      await this.notifications.send(
        registrants.map((row) => row.userId),
        {
          type: "EVENT",
          title: `Cancelled: ${updated.title}`,
          body: "This event has been cancelled.",
          data: { eventId: id, organizationId: updated.organizationId },
        },
      );
    }

    return updated;
  }

  /**
   * Members see upcoming published events. People who can manage events see
   * everything and may filter by status.
   */
  async list(user: AuthUser, organizationId: string, status?: EventStatus) {
    const canManage = await this.permissions.can(
      user,
      organizationId,
      "event.manage",
    );

    if (!canManage) {
      await this.access.assertMember(user, organizationId);
    }

    const now = new Date();

    const events = await this.prisma.event.findMany({
      where: canManage
        ? { organizationId, ...(status ? { status } : {}) }
        : {
            organizationId,
            status: "PUBLISHED",
            OR: [
              { endsAt: { gte: now } },
              {
                endsAt: null,
                startsAt: {
                  gte: new Date(now.getTime() - DEFAULT_DURATION_MS),
                },
              },
            ],
          },
      include: {
        _count: { select: { registrations: true } },
        registrations: {
          where: { userId: user.id },
          select: { id: true, checkedInAt: true },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 100,
    });

    return events.map(({ registrations, _count, ...event }) => ({
      ...event,
      registeredCount: _count.registrations,
      registered: registrations.length > 0,
      checkedInAt: registrations[0]?.checkedInAt ?? null,
    }));
  }

  async register(user: AuthUser, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organization: { select: { type: true } } },
    });

    if (!event || event.status !== "PUBLISHED") {
      throw new NotFoundException("Event not found.");
    }

    await this.access.assertMember(user, event.organizationId);

    const end =
      event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_DURATION_MS);

    if (end < new Date()) {
      throw new BadRequestException("This event has ended.");
    }

    const worship =
      event.organization.type === "CHURCH" ||
      event.organization.type === "MOSQUE";

    const churchMemberId = worship
      ? (await this.access.ensureMember(user.id, event.organizationId)).id
      : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the event so two people cannot take the last seat together.
        await tx.$queryRaw`SELECT 1 FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`;

        if (event.capacity !== null) {
          const taken = await tx.eventRegistration.count({
            where: { eventId: event.id },
          });

          if (taken >= event.capacity) {
            throw new ConflictException("This event is full.");
          }
        }

        return tx.eventRegistration.create({
          data: { eventId: event.id, userId: user.id, churchMemberId },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("You are already registered.");
      }

      throw error;
    }
  }

  async unregister(user: AuthUser, eventId: string) {
    // Once someone has been checked in they cannot withdraw.
    await this.prisma.eventRegistration.deleteMany({
      where: { eventId, userId: user.id, checkedInAt: null },
    });

    return { ok: true };
  }

  private async loadForStaff(user: AuthUser, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    const allowed =
      (await this.permissions.can(
        user,
        event.organizationId,
        "event.manage",
      )) ||
      (await this.permissions.can(
        user,
        event.organizationId,
        "attendance.mark",
      ));

    if (!allowed) {
      throw new ForbiddenException("You do not have permission to do this");
    }

    return event;
  }

  async registrations(user: AuthUser, eventId: string) {
    await this.loadForStaff(user, eventId);

    return this.prisma.eventRegistration.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
            phone: true,
          },
        },
      },
      orderBy: { registeredAt: "asc" },
    });
  }

  /** Marks attendance for several members at once, creating or updating each. */
  async markAttendance(
    user: AuthUser,
    eventId: string,
    dto: MarkAttendanceDto,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    await this.access.assertWorship(event.organizationId);
    await this.permissions.assert(
      user,
      event.organizationId,
      "attendance.mark",
    );

    const entries = [
      ...new Map(dto.entries.map((entry) => [entry.userId, entry])).values(),
    ];

    const members = await this.prisma.membership.findMany({
      where: {
        organizationId: event.organizationId,
        status: "APPROVED",
        userId: { in: entries.map((entry) => entry.userId) },
      },
      select: { userId: true },
    });

    if (members.length !== entries.length) {
      throw new BadRequestException(
        "Every person listed must be an approved member of this organization.",
      );
    }

    const now = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        for (const entry of entries) {
          const member = await tx.churchMember.upsert({
            where: {
              userId_organizationId: {
                userId: entry.userId,
                organizationId: event.organizationId,
              },
            },
            create: {
              userId: entry.userId,
              organizationId: event.organizationId,
              joinedAt: now,
            },
            update: {},
          });

          const status = entry.status ?? "PRESENT";

          const existing = await tx.attendance.findFirst({
            where: { eventId, churchMemberId: member.id },
            select: { id: true },
          });

          if (existing) {
            await tx.attendance.update({
              where: { id: existing.id },
              data: { status, notes: entry.notes, markedById: user.id },
            });
          } else {
            await tx.attendance.create({
              data: {
                organizationId: event.organizationId,
                eventId,
                churchMemberId: member.id,
                markedById: user.id,
                status,
                notes: entry.notes,
                date: now,
              },
            });
          }

          if (status === "PRESENT" || status === "LATE") {
            await tx.eventRegistration.updateMany({
              where: { eventId, userId: entry.userId, checkedInAt: null },
              data: { checkedInAt: now },
            });
          }
        }
      },
      { timeout: 30_000 },
    );

    return { ok: true, marked: entries.length };
  }

  async attendance(user: AuthUser, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    await this.permissions.assert(
      user,
      event.organizationId,
      "attendance.mark",
    );

    return this.prisma.attendance.findMany({
      where: { eventId },
      include: {
        churchMember: {
          select: {
            id: true,
            memberNumber: true,
            user: {
              select: {
                id: true,
                firstName: true,
                otherNames: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { date: "asc" },
    });
  }
}
