
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { EventStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../common/permissions/permissions.service";
import { AuthUser } from "../common/decorators/current-user.decorator";
import { NotificationsService } from "../notifications/notifications.service";
import { ChurchAccessService } from "./church-access.service";

import { MailService } from "../mail/mail.service";
import { MailTemplatesService } from "../mail/mail-templates.service";

import { eventAnnouncementTemplate } from "../mail/templates/events/event-announcement.template";
import { eventRegistrationTemplate } from "../mail/templates/events/event-registration.template";
import { eventCancellationTemplate } from "../mail/templates/events/event-cancellation.template";
import { eventUpdatedTemplate } from "../mail/templates/events/event-updated.template";

import {
  CreateEventDto,
  MarkAttendanceDto,
  UpdateEventDto,
} from "./dto/church.dto";

/** Events without an end time count as running for this long. */
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000;

interface EventEmailRecipient {
  id: string;
  email: string | null;
  firstName: string | null;
  otherNames: string | null;
  lastName: string | null;
}

interface EventEmailDetails {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
}

@Injectable()
export class ChurchEventsService {
  private readonly logger = new Logger(ChurchEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly access: ChurchAccessService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
  ) {}

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is not a valid date.`);
    }

    return date;
  }

  /** Format dates using the Lagos timezone. */
  private formatEventDate(date: Date): string {
    return new Intl.DateTimeFormat("en-NG", {
      timeZone: "Africa/Lagos",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  /** Format event time using the Lagos timezone. */
  private formatEventTime(date: Date): string {
    return new Intl.DateTimeFormat("en-NG", {
      timeZone: "Africa/Lagos",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }

  /** Build a readable recipient name. */
  private recipientName(user: EventEmailRecipient): string {
    const name = [
      user.firstName,
      user.otherNames,
      user.lastName,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ")
      .trim();

    return name || "there";
  }

  /** Fetch email recipients separately from event API responses. */
  private async getEmailRecipients(
    userIds: string[],
  ): Promise<EventEmailRecipient[]> {
    const uniqueIds = [...new Set(userIds)];

    if (!uniqueIds.length) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        otherNames: true,
        lastName: true,
      },
    });
  }

  /**
   * Send personalized event emails.
   * Email failures do not undo successful event operations.
   */
  private async sendEventEmails(
    userIds: string[],
    subject: string,
    buildHtml: (recipientName: string) => string,
  ): Promise<void> {
    try {
      const recipients = await this.getEmailRecipients(userIds);

      await Promise.all(
        recipients.map(async (recipient) => {
          if (!recipient.email) {
            return;
          }

          try {
            const html = buildHtml(this.recipientName(recipient));

            const sent = await this.mail.send(
              recipient.email,
              subject,
              html,
            );

            if (!sent) {
              this.logger.warn(
                `Event email was not accepted for user ${recipient.id}.`,
              );
            }
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? error.message
                : "Unknown email delivery error";

            this.logger.error(
              `Event email failed for user ${recipient.id}: ${message}`,
            );
          }
        }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown recipient lookup error";

      this.logger.error(
        `Unable to retrieve event email recipients: ${message}`,
      );
    }
  }

  /** Get registered attendee IDs for an event. */
  private async registeredUserIds(eventId: string): Promise<string[]> {
    const registrations = await this.prisma.eventRegistration.findMany({
      where: { eventId },
      select: { userId: true },
    });

    return [...new Set(registrations.map((row) => row.userId))];
  }

  /** Get approved community member IDs. */
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

  /**
   * Fetch the organization name independently.
   */
  private async getOrganizationName(
    organizationId: string,
  ): Promise<string | undefined> {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });

      return organization?.name ?? undefined;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown organization lookup error";

      this.logger.warn(
        `Unable to retrieve organization name: ${message}`,
      );

      return undefined;
    }
  }

  /**
   * Publish announcement through in-app notifications and email.
   */
  private async announce(
    event: EventEmailDetails,
    actorId: string,
  ): Promise<void> {
    const memberIds = await this.approvedMemberIds(
      event.organizationId,
      actorId,
    );

    if (!memberIds.length) {
      return;
    }

    // In-app notification.
    await this.notifications.send(memberIds, {
      type: "EVENT",
      title: `New event: ${event.title}`,
      body: `Starts ${event.startsAt.toUTCString()}`,
      data: {
        eventId: event.id,
        organizationId: event.organizationId,
        startsAt: event.startsAt.toISOString(),
      },
    });

    const organizationName = await this.getOrganizationName(
      event.organizationId,
    );

    // Email announcement.
    await this.sendEventEmails(
      memberIds,
      `New community event: ${event.title}`,
      (recipientName) =>
        this.mailTemplates.render(eventAnnouncementTemplate, {
          recipientName,
          eventTitle: event.title,
          eventDescription: event.description ?? undefined,
          organizationName,
          startsAt: `${this.formatEventDate(event.startsAt)} at ${this.formatEventTime(event.startsAt)}`,
          endsAt: event.endsAt
            ? `${this.formatEventDate(event.endsAt)} at ${this.formatEventTime(event.endsAt)}`
            : undefined,
          location: event.location ?? undefined,
        }),
    );
  }

  /** Send registration confirmation to one member. */
  private async sendRegistrationEmail(
    userId: string,
    event: {
      title: string;
      startsAt: Date;
      location: string | null;
    },
  ): Promise<void> {
    await this.sendEventEmails(
      [userId],
      `Registration confirmed: ${event.title}`,
      (recipientName) =>
        this.mailTemplates.render(eventRegistrationTemplate, {
          recipientName,
          eventName: event.title,
          eventDate: this.formatEventDate(event.startsAt),
          eventTime: this.formatEventTime(event.startsAt),
          venue: event.location ?? undefined,
        }),
    );
  }

  /** Notify registered attendees about cancellation. */
  private async sendCancellationEmails(
    event: EventEmailDetails,
  ): Promise<void> {
    try {
      const userIds = await this.registeredUserIds(event.id);

      await this.sendEventEmails(
        userIds,
        `Event cancelled: ${event.title}`,
        (recipientName) =>
          this.mailTemplates.render(eventCancellationTemplate, {
            recipientName,
            eventName: event.title,
            eventDate: this.formatEventDate(event.startsAt),
            eventTime: this.formatEventTime(event.startsAt),
            venue: event.location ?? undefined,
            cancelledAt: this.formatEventDate(new Date()),
          }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown cancellation email error";

      this.logger.error(
        `Unable to send cancellation emails for event ${event.id}: ${message}`,
      );
    }
  }

  /** Notify registered attendees about important event changes. */
  private async sendUpdateEmails(
    event: EventEmailDetails,
    updateMessage: string,
  ): Promise<void> {
    try {
      const userIds = await this.registeredUserIds(event.id);

      await this.sendEventEmails(
        userIds,
        `Event updated: ${event.title}`,
        (recipientName) =>
          this.mailTemplates.render(eventUpdatedTemplate, {
            recipientName,
            eventName: event.title,
            updateMessage,
            eventDate: this.formatEventDate(event.startsAt),
            eventTime: this.formatEventTime(event.startsAt),
            venue: event.location ?? undefined,
          }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown event update email error";

      this.logger.error(
        `Unable to send update emails for event ${event.id}: ${message}`,
      );
    }
  }

  async create(
    user: AuthUser,
    organizationId: string,
    dto: CreateEventDto,
  ) {
    await this.permissions.assert(user, organizationId, "event.manage");

    const status = dto.status ?? EventStatus.DRAFT;

    if (
      status === EventStatus.CANCELLED ||
      status === EventStatus.COMPLETED
    ) {
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
      include: {
        _count: {
          select: { registrations: true },
        },
      },
    });

    if (!event) {
      throw new NotFoundException("Event not found.");
    }

    await this.permissions.assert(
      user,
      event.organizationId,
      "event.manage",
    );

    // Cancelled and completed events cannot be edited.
    if (
      event.status === EventStatus.CANCELLED ||
      event.status === EventStatus.COMPLETED
    ) {
      throw new BadRequestException("A closed event cannot be edited.");
    }

    // Published events cannot be changed back to draft.
    if (
      dto.status === EventStatus.DRAFT &&
      event.status !== EventStatus.DRAFT
    ) {
      throw new BadRequestException(
        "A published event cannot go back to draft.",
      );
    }

    const startsAt = dto.startsAt
      ? this.parseDate(dto.startsAt, "startsAt")
      : event.startsAt;

    const endsAt =
      dto.endsAt !== undefined
        ? dto.endsAt
          ? this.parseDate(dto.endsAt, "endsAt")
          : null
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
        ...(dto.title !== undefined
          ? { title: dto.title.trim() }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.location !== undefined
          ? { location: dto.location.trim() }
          : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(dto.capacity !== undefined
          ? { capacity: dto.capacity }
          : {}),
        ...(dto.status !== undefined
          ? { status: dto.status }
          : {}),
      },
    });

    // Draft -> published: announce to approved community members.
    if (
      dto.status === EventStatus.PUBLISHED &&
      event.status !== EventStatus.PUBLISHED
    ) {
      await this.announce(updated, user.id);
    }

    // Event cancellation.
    // The earlier guard already guarantees that the old status
    // cannot be CANCELLED, so no second status comparison is needed.
    if (dto.status === EventStatus.CANCELLED) {
      const registrants = await this.prisma.eventRegistration.findMany({
        where: { eventId: id },
        select: { userId: true },
      });

      const registrantIds = [
        ...new Set(registrants.map((row) => row.userId)),
      ];

      if (registrantIds.length) {
        await this.notifications.send(registrantIds, {
          type: "EVENT",
          title: `Cancelled: ${updated.title}`,
          body: "This event has been cancelled.",
          data: {
            eventId: id,
            organizationId: updated.organizationId,
          },
        });
      }

      await this.sendCancellationEmails(updated);
    }

    // Detect important changes to an already-published event.
    if (
      event.status === EventStatus.PUBLISHED &&
      updated.status === EventStatus.PUBLISHED
    ) {
      const changes: string[] = [];

      if (
        dto.title !== undefined &&
        updated.title !== event.title
      ) {
        changes.push("The event title has changed.");
      }

      if (
        dto.description !== undefined &&
        updated.description !== event.description
      ) {
        changes.push("The event description has been updated.");
      }

      if (
        dto.startsAt !== undefined &&
        updated.startsAt.getTime() !== event.startsAt.getTime()
      ) {
        changes.push("The event date or start time has changed.");
      }

      if (
        dto.endsAt !== undefined &&
        updated.endsAt?.getTime() !== event.endsAt?.getTime()
      ) {
        changes.push("The event end time has changed.");
      }

      if (
        dto.location !== undefined &&
        updated.location !== event.location
      ) {
        changes.push("The event venue or location has changed.");
      }

      if (changes.length > 0) {
        await this.sendUpdateEmails(updated, changes.join(" "));
      }
    }

    return updated;
  }

  /**
   * Members see upcoming published events. People who can manage events see
   * everything and may filter by status.
   */
  async list(
    user: AuthUser,
    organizationId: string,
    status?: EventStatus,
  ) {
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
            status: EventStatus.PUBLISHED,
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
        _count: {
          select: { registrations: true },
        },
        registrations: {
          where: { userId: user.id },
          select: {
            id: true,
            checkedInAt: true,
          },
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
      include: {
        organization: {
          select: { type: true },
        },
      },
    });

    if (!event || event.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException("Event not found.");
    }

    await this.access.assertMember(user, event.organizationId);

    const end =
      event.endsAt ??
      new Date(event.startsAt.getTime() + DEFAULT_DURATION_MS);

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
      const registration = await this.prisma.$transaction(async (tx) => {
        // Lock the event to prevent simultaneous registrations
        // from taking the final available seat.
        await tx.$queryRaw`
          SELECT 1 FROM "Event"
          WHERE "id" = ${event.id}
          FOR UPDATE
        `;

        if (event.capacity !== null) {
          const taken = await tx.eventRegistration.count({
            where: { eventId: event.id },
          });

          if (taken >= event.capacity) {
            throw new ConflictException("This event is full.");
          }
        }

        return tx.eventRegistration.create({
          data: {
            eventId: event.id,
            userId: user.id,
            churchMemberId,
          },
        });
      });

      // Send confirmation after the transaction commits.
      await this.sendRegistrationEmail(user.id, event);

      return registration;
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
    await this.prisma.eventRegistration.deleteMany({
      where: {
        eventId,
        userId: user.id,
        checkedInAt: null,
      },
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
      throw new ForbiddenException(
        "You do not have permission to do this.",
      );
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

    // Remove duplicate user IDs before processing.
    const entries = [
      ...new Map(
        dto.entries.map((entry) => [entry.userId, entry]),
      ).values(),
    ];

    const members = await this.prisma.membership.findMany({
      where: {
        organizationId: event.organizationId,
        status: "APPROVED",
        userId: {
          in: entries.map((entry) => entry.userId),
        },
      },
      select: {
        userId: true,
      },
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
            where: {
              eventId,
              churchMemberId: member.id,
            },
            select: {
              id: true,
            },
          });

          if (existing) {
            await tx.attendance.update({
              where: { id: existing.id },
              data: {
                status,
                notes: entry.notes,
                markedById: user.id,
              },
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
              where: {
                eventId,
                userId: entry.userId,
                checkedInAt: null,
              },
              data: {
                checkedInAt: now,
              },
            });
          }
        }
      },
      { timeout: 30_000 },
    );

    return {
      ok: true,
      marked: entries.length,
    };
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
