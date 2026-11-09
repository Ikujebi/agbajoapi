// src/artisans/bookings.service.ts

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, ServiceBookingStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailOutboxService } from '../email-outbox/email-outbox.service';
import type { QueueServiceBookingEmailInput } from '../email-outbox/email-outbox.service';

import { AuthUser } from '../common/decorators/current-user.decorator';
import { displayName } from '../common/utils/names';
import { normalizePhone } from '../common/utils/phone';

import {
  AcceptBookingDto,
  BookingQueryDto,
  CompleteBookingDto,
  CreateBookingDto,
  ReasonDto,
  ScheduleBookingDto,
} from './dto/artisan.dto';

type Actor = 'customer' | 'artisan' | 'either';

const OPEN: ServiceBookingStatus[] = [
  'REQUESTED',
  'ACCEPTED',
  'SCHEDULED',
  'IN_PROGRESS',
];

/** Contact details are shared with the other side only once a job is accepted. */
const CONTACT_SHARED = new Set<ServiceBookingStatus>([
  'ACCEPTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
]);

/** Who may move a booking from one status to another. */
const FLOW: Record<
  ServiceBookingStatus,
  Partial<Record<ServiceBookingStatus, Actor>>
> = {
  REQUESTED: {
    ACCEPTED: 'artisan',
    DECLINED: 'artisan',
    CANCELLED: 'customer',
  },
  ACCEPTED: {
    SCHEDULED: 'artisan',
    IN_PROGRESS: 'artisan',
    CANCELLED: 'either',
  },
  SCHEDULED: {
    IN_PROGRESS: 'artisan',
    COMPLETED: 'artisan',
    CANCELLED: 'either',
  },
  IN_PROGRESS: {
    COMPLETED: 'artisan',
    CANCELLED: 'artisan',
  },
  COMPLETED: {},
  DECLINED: {},
  CANCELLED: {},
};

const MAX_OPEN_PER_CUSTOMER = 10;
const REQUEST_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;

const PERSON = {
  id: true,
  firstName: true,
  otherNames: true,
  lastName: true,
  avatarUrl: true,
  phone: true,
} as const;

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

const BOOKING_INCLUDE = {
  service: {
    select: {
      id: true,
      name: true,
      basePrice: true,
    },
  },
  artisan: {
    select: {
      id: true,
      userId: true,
      headline: true,
      user: {
        select: PERSON,
      },
    },
  },
  customer: {
    select: PERSON,
  },
  review: {
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ServiceBookingInclude;

type BookingWithRelations = Prisma.ServiceBookingGetPayload<{
  include: typeof BOOKING_INCLUDE;
}>;

type BookingRole = 'customer' | 'artisan';

type BookingEmailFactory = (
  booking: BookingWithRelations,
  role: BookingRole,
) => QueueServiceBookingEmailInput;

@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly emailOutbox: EmailOutboxService,
  ) {}

  // ---------- helpers ----------

  /**
   * Hides the other side's phone number until the artisan accepts.
   */
  private present(booking: BookingWithRelations, viewerId: string) {
    const viewerIsCustomer = booking.customerId === viewerId;
    const shared = CONTACT_SHARED.has(booking.status);

    return {
      ...booking,
      customerPhone:
        viewerIsCustomer || shared ? booking.customerPhone : null,
      customer: {
        ...booking.customer,
        phone: viewerIsCustomer || shared ? booking.customer.phone : null,
      },
      artisan: {
        ...booking.artisan,
        user: {
          ...booking.artisan.user,
          phone:
            !viewerIsCustomer || shared
              ? booking.artisan.user.phone
              : null,
        },
      },
    };
  }

  private async isBlocked(a: string, b: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: {
        id: true,
      },
    });

    return Boolean(block);
  }

  private async loadFor(user: AuthUser, id: string) {
    const booking = await this.prisma.serviceBooking.findUnique({
      where: { id },
      include: BOOKING_INCLUDE,
    });

    const involved =
      booking &&
      (booking.customerId === user.id ||
        booking.artisan.userId === user.id);

    if (!booking || !involved) {
      throw new NotFoundException('Booking not found.');
    }

    return booking;
  }

  private async isBlockedForBooking(
    customerId: string,
    artisanUserId: string,
  ): Promise<void> {
    if (await this.isBlocked(customerId, artisanUserId)) {
      throw new ForbiddenException('You cannot book this artisan.');
    }
  }

  // ---------- customer: request ----------

  async create(
    user: AuthUser,
    serviceId: string,
    dto: CreateBookingDto,
  ) {
    const service = await this.prisma.artisanService.findUnique({
      where: {
        id: serviceId,
      },
      include: {
        artisanProfile: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (
      !service ||
      !service.isActive ||
      !service.artisanProfile.user.isActive
    ) {
      throw new NotFoundException('Service not found.');
    }

    const artisanUserId = service.artisanProfile.userId;

    if (artisanUserId === user.id) {
      throw new BadRequestException(
        'You cannot book your own service.',
      );
    }

    await this.isBlockedForBooking(user.id, artisanUserId);

    const open = await this.prisma.serviceBooking.count({
      where: {
        customerId: user.id,
        status: {
          in: OPEN,
        },
      },
    });

    if (open >= MAX_OPEN_PER_CUSTOMER) {
      throw new BadRequestException(
        `You can have at most ${MAX_OPEN_PER_CUSTOMER} open bookings. Finish or cancel some first.`,
      );
    }

    let scheduledAt: Date | undefined;

    if (dto.scheduledAt) {
      scheduledAt = new Date(dto.scheduledAt);

      if (
        Number.isNaN(scheduledAt.getTime()) ||
        scheduledAt <= new Date()
      ) {
        throw new BadRequestException(
          'scheduledAt must be a future date.',
        );
      }
    }

    const customer = await this.prisma.user.findUniqueOrThrow({
      where: {
        id: user.id,
      },
      select: {
        phone: true,
        firstName: true,
        otherNames: true,
        lastName: true,
      },
    });

    let neighborhoodId = dto.neighborhoodId;

    if (neighborhoodId) {
      const exists = await this.prisma.neighborhood.findFirst({
        where: {
          id: neighborhoodId,
          isActive: true,
        },
        select: {
          id: true,
        },
      });

      if (!exists) {
        throw new BadRequestException('Neighborhood not found.');
      }
    } else {
      const primary = await this.prisma.userNeighborhood.findFirst({
        where: {
          userId: user.id,
          isPrimary: true,
        },
        select: {
          neighborhoodId: true,
        },
      });

      neighborhoodId = primary?.neighborhoodId;
    }

    const customerName = displayName(customer);

    // Booking creation and email queueing commit or roll back together.
    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceBooking.create({
        data: {
          serviceId,
          artisanProfileId: service.artisanProfile.id,
          customerId: user.id,
          neighborhoodId,
          description: dto.description.trim(),
          scheduledAt,
          address: dto.address.trim(),
          customerPhone: dto.customerPhone
            ? normalizePhone(dto.customerPhone)
            : customer.phone,
        },
        include: BOOKING_INCLUDE,
      });

      await this.emailOutbox.enqueueServiceBookingEmail(tx, {
        recipientId: artisanUserId,
        subject: `New service booking request: ${service.name}`,
        dedupeKey: `booking:${created.id}:requested:${artisanUserId}`,
        payload: {
          title: 'New booking request',
          message: `${customerName} has requested your service. Review the booking and respond when you are ready.`,
          serviceName: service.name,
          bookingId: created.id,
          details: [
            `Customer: ${customerName}`,
            `Requested date: ${
              scheduledAt
                ? scheduledAt.toLocaleString('en-NG', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Africa/Lagos',
                  })
                : 'Not specified'
            }`,
          ],
        },
      });

      return created;
    });

    await this.notifications.send([artisanUserId], {
      type: 'SERVICE_BOOKING',
      title: `New booking request: ${service.name}`,
      body: `${customerName} would like to book you.`,
      data: {
        bookingId: booking.id,
      },
    });

    return this.present(booking, user.id);
  }

  // ---------- status changes ----------

  /**
   * Moves a booking to a new status if the caller is allowed to.
   *
   * The status update and email queue record are written in the same
   * transaction. The conditional update prevents duplicate transitions.
   */
  private async move(
    user: AuthUser,
    id: string,
    to: ServiceBookingStatus,
    data: Prisma.ServiceBookingUpdateManyMutationInput = {},
    emailFactory?: BookingEmailFactory,
  ) {
    const booking = await this.loadFor(user, id);
    const role: BookingRole =
      booking.customerId === user.id ? 'customer' : 'artisan';

    const allowed = FLOW[booking.status][to];

    if (!allowed) {
      throw new BadRequestException(
        `A ${booking.status.toLowerCase().replace('_', ' ')} booking cannot become ${to.toLowerCase().replace('_', ' ')}.`,
      );
    }

    if (allowed !== 'either' && allowed !== role) {
      throw new ForbiddenException(
        `Only the ${allowed} can do this.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.serviceBooking.updateMany({
        where: {
          id,
          status: booking.status,
        },
        data: {
          ...data,
          status: to,
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException(
          'This booking was just updated. Refresh and try again.',
        );
      }

      if (to === 'COMPLETED') {
        await tx.artisanProfile.update({
          where: {
            id: booking.artisanProfileId,
          },
          data: {
            completedJobs: {
              increment: 1,
            },
          },
        });
      }

      if (emailFactory) {
        await this.emailOutbox.enqueueServiceBookingEmail(
          tx,
          emailFactory(booking, role),
        );
      }
    });

    return {
      booking,
      role,
    };
  }

  private async tell(
    recipientId: string,
    title: string,
    body: string,
    bookingId: string,
  ) {
    await this.notifications.send([recipientId], {
      type: 'SERVICE_BOOKING',
      title,
      body,
      data: {
        bookingId,
      },
    });
  }

  // ---------- accept ----------

  async accept(
    user: AuthUser,
    id: string,
    dto: AcceptBookingDto,
  ) {
    const price =
      dto.quotedPrice !== undefined
        ? money(dto.quotedPrice).toFixed(2)
        : undefined;

    const { booking } = await this.move(
      user,
      id,
      'ACCEPTED',
      {
        ...(dto.quotedPrice !== undefined
          ? {
              quotedPrice: money(dto.quotedPrice),
            }
          : {}),
      },
      (current) => ({
        recipientId: current.customerId,
        subject: `Your booking was accepted: ${current.service.name}`,
        dedupeKey: `booking:${current.id}:accepted:${current.customerId}`,
        payload: {
          title: 'Booking accepted',
          message: `Good news! Your booking request for ${current.service.name} has been accepted by the artisan.`,
          serviceName: current.service.name,
          bookingId: current.id,
          details: price ? [`Quoted price: ₦${price}`] : [],
        },
      }),
    );

    await this.tell(
      booking.customerId,
      'Booking accepted',
      `${booking.service.name} was accepted.${
        price ? ` Quoted price: ₦${price}.` : ''
      }`,
      id,
    );

    return this.get(user, id);
  }

  // ---------- decline ----------

  async decline(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
  ) {
    const reason = dto.reason?.trim();

    const { booking } = await this.move(
      user,
      id,
      'DECLINED',
      {},
      (current) => ({
        recipientId: current.customerId,
        subject: `Booking declined: ${current.service.name}`,
        dedupeKey: `booking:${current.id}:declined:${current.customerId}`,
        payload: {
          title: 'Booking declined',
          message: `Unfortunately, your booking request for ${current.service.name} was declined by the artisan.`,
          serviceName: current.service.name,
          bookingId: current.id,
          details: reason ? [`Reason: ${reason}`] : [],
        },
      }),
    );

    await this.tell(
      booking.customerId,
      'Booking declined',
      `${booking.service.name} was declined.${
        reason ? ` ${reason}` : ''
      }`,
      id,
    );

    return this.get(user, id);
  }

  // ---------- schedule ----------

  async schedule(
    user: AuthUser,
    id: string,
    dto: ScheduleBookingDto,
  ) {
    const scheduledAt = new Date(dto.scheduledAt);

    if (
      Number.isNaN(scheduledAt.getTime()) ||
      scheduledAt <= new Date()
    ) {
      throw new BadRequestException(
        'scheduledAt must be a future date.',
      );
    }

    const formattedDate = scheduledAt.toLocaleString('en-NG', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    });

    const { booking } = await this.move(
      user,
      id,
      'SCHEDULED',
      {
        scheduledAt,
      },
      (current) => ({
        recipientId: current.customerId,
        subject: `Booking scheduled: ${current.service.name}`,
        dedupeKey: `booking:${current.id}:scheduled:${current.customerId}`,
        payload: {
          title: 'Booking scheduled',
          message: `Your booking for ${current.service.name} has been scheduled.`,
          serviceName: current.service.name,
          bookingId: current.id,
          details: [`Scheduled date: ${formattedDate}`],
        },
      }),
    );

    await this.tell(
      booking.customerId,
      'Booking scheduled',
      `${booking.service.name} is set for ${formattedDate}.`,
      id,
    );

    return this.get(user, id);
  }

  // ---------- start ----------

  async start(user: AuthUser, id: string) {
    const { booking } = await this.move(
      user,
      id,
      'IN_PROGRESS',
      {},
      (current) => ({
        recipientId: current.customerId,
        subject: `Work has started: ${current.service.name}`,
        dedupeKey: `booking:${current.id}:started:${current.customerId}`,
        payload: {
          title: 'Work has started',
          message: `The artisan has marked your ${current.service.name} booking as in progress.`,
          serviceName: current.service.name,
          bookingId: current.id,
        },
      }),
    );

    await this.tell(
      booking.customerId,
      'Work has started',
      `${booking.service.name} is now in progress.`,
      id,
    );

    return this.get(user, id);
  }

  // ---------- complete ----------

  async complete(
    user: AuthUser,
    id: string,
    dto: CompleteBookingDto,
  ) {
    const existing = await this.loadFor(user, id);

    const finalPrice =
      dto.finalPrice !== undefined
        ? money(dto.finalPrice)
        : existing.quotedPrice;

    const finalPriceText = finalPrice?.toFixed(2);

    const { booking } = await this.move(
      user,
      id,
      'COMPLETED',
      {
        completedAt: new Date(),
        ...(finalPrice ? { finalPrice } : {}),
      },
      (current) => ({
        recipientId: current.customerId,
        subject: `Job completed: ${current.service.name}`,
        dedupeKey: `booking:${current.id}:completed:${current.customerId}`,
        payload: {
          title: 'Your service is complete',
          message: `The artisan has marked your ${current.service.name} booking as completed. You can now share your experience by leaving a review.`,
          serviceName: current.service.name,
          bookingId: current.id,
          details: finalPriceText
            ? [`Final price: ₦${finalPriceText}`]
            : [],
        },
      }),
    );

    await this.tell(
      booking.customerId,
      'Job completed',
      `${booking.service.name} is done. How did it go? Leave a review.`,
      id,
    );

    return this.get(user, id);
  }

  // ---------- cancel ----------

  async cancel(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
  ) {
    const reason = dto.reason?.trim();

    const { booking, role } = await this.move(
      user,
      id,
      'CANCELLED',
      {},
      (current, actorRole) => {
        const otherSide =
          actorRole === 'customer'
            ? current.artisan.userId
            : current.customerId;

        return {
          recipientId: otherSide,
          subject: `Booking cancelled: ${current.service.name}`,
          dedupeKey: `booking:${current.id}:cancelled:${otherSide}`,
          payload: {
            title: 'Booking cancelled',
            message: `The ${actorRole} has cancelled the booking for ${current.service.name}.`,
            serviceName: current.service.name,
            bookingId: current.id,
            details: [
              `Cancelled by: ${actorRole}`,
              ...(reason ? [`Reason: ${reason}`] : []),
            ],
          },
        };
      },
    );

    const otherSide =
      role === 'customer'
        ? booking.artisan.userId
        : booking.customerId;

    const message =
      `${booking.service.name} was cancelled by the ${role}.` +
      (reason ? ` ${reason}` : '');

    await this.tell(
      otherSide,
      'Booking cancelled',
      message,
      id,
    );

    return this.get(user, id);
  }

  // ---------- read ----------

  async get(user: AuthUser, id: string) {
    return this.present(
      await this.loadFor(user, id),
      user.id,
    );
  }

  private async page(
    where: Prisma.ServiceBookingWhereInput,
    query: BookingQueryDto,
    viewerId: string,
  ) {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const rows = await this.prisma.serviceBooking.findMany({
      where: {
        ...where,
        ...(query.status
          ? {
              status: query.status,
            }
          : {}),
      },
      include: BOOKING_INCLUDE,
      orderBy: [
        {
          requestedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take: limit + 1,
      ...(query.cursor
        ? {
            cursor: {
              id: query.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map((row) => this.present(row, viewerId)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /** Bookings I made as a customer. */
  mine(
    user: AuthUser,
    query: BookingQueryDto,
  ) {
    return this.page(
      {
        customerId: user.id,
      },
      query,
      user.id,
    );
  }

  /** Bookings other people made with me as the artisan. */
  received(
    user: AuthUser,
    query: BookingQueryDto,
  ) {
    return this.page(
      {
        artisan: {
          userId: user.id,
        },
      },
      query,
      user.id,
    );
  }

  // ---------- housekeeping ----------

  /**
   * A request nobody answers for a week is cancelled
   * so customers can move on.
   *
   * Each successful cancellation and its email queue record
   * are committed together.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async expireUnansweredRequests(): Promise<void> {
    try {
      const stale = await this.prisma.serviceBooking.findMany({
        where: {
          status: 'REQUESTED',
          requestedAt: {
            lt: new Date(Date.now() - REQUEST_EXPIRY_MS),
          },
        },
        select: {
          id: true,
          customerId: true,
          service: {
            select: {
              name: true,
            },
          },
        },
        take: 500,
      });

      if (stale.length === 0) {
        return;
      }

      const expired = await this.prisma.$transaction(async (tx) => {
        const successfullyExpired: typeof stale = [];

        for (const row of stale) {
          const claimed = await tx.serviceBooking.updateMany({
            where: {
              id: row.id,
              status: 'REQUESTED',
            },
            data: {
              status: 'CANCELLED',
            },
          });

          // Another request may have changed this booking already.
          if (claimed.count !== 1) {
            continue;
          }

          await this.emailOutbox.enqueueServiceBookingEmail(tx, {
            recipientId: row.customerId,
            subject: `Booking request expired: ${row.service.name}`,
            dedupeKey: `booking:${row.id}:expired:${row.customerId}`,
            payload: {
              title: 'Booking request expired',
              message: `Nobody answered your booking request for ${row.service.name} within the response period, so it has been cancelled. You can now find and book another artisan.`,
              serviceName: row.service.name,
              bookingId: row.id,
            },
          });

          successfullyExpired.push(row);
        }

        return successfullyExpired;
      });

      for (const row of expired) {
        const message =
          `Nobody answered your request for ${row.service.name}, ` +
          'so it was cancelled. You can book someone else.';

        await this.tell(
          row.customerId,
          'Booking request expired',
          message,
          row.id,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown expiry error';

      this.log.error(`Expiring requests failed: ${message}`);
    }
  }
}