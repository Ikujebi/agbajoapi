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
import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { serviceBookingTemplate } from '../mail/templates';

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
  // Once work has started only the artisan can call it off.
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

@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
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

  /**
   * Sends a booking email without allowing email-provider failures
   * to interrupt the booking operation.
   *
   * Recipient email addresses are fetched separately and are never
   * included in the booking API response.
   */
  private async sendBookingEmail(
    recipientId: string,
    subject: string,
    options: {
      title: string;
      message: string;
      serviceName: string;
      bookingId: string;
      details?: string[];
    },
  ): Promise<void> {
    try {
      const recipient = await this.prisma.user.findUnique({
        where: {
          id: recipientId,
        },
        select: {
          email: true,
          firstName: true,
          otherNames: true,
          lastName: true,
        },
      });

      if (!recipient?.email) {
        this.log.warn(
          `Booking email skipped: recipient ${recipientId} has no email address.`,
        );
        return;
      }

      const html = this.mailTemplates.render(serviceBookingTemplate, {
        recipientName: displayName(recipient),
        title: options.title,
        message: options.message,
        serviceName: options.serviceName,
        bookingId: options.bookingId,
        details: options.details,
      });

      const sent = await this.mail.send(
        recipient.email,
        subject,
        html,
      );

      if (!sent) {
        this.log.warn(
          `Booking email was not accepted for recipient ${recipientId}.`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown email delivery error';

      this.log.error(
        `Booking email failed for recipient ${recipientId}: ${message}`,
      );
    }
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

    const booking = await this.prisma.serviceBooking.create({
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

    const customerName = displayName(customer);

    await this.notifications.send([artisanUserId], {
      type: 'SERVICE_BOOKING',
      title: `New booking request: ${service.name}`,
      body: `${customerName} would like to book you.`,
      data: {
        bookingId: booking.id,
      },
    });

    // Email the artisan about the new request.
    await this.sendBookingEmail(
      artisanUserId,
      `New service booking request: ${service.name}`,
      {
        title: 'New booking request',
        message: `${customerName} has requested your service. Review the booking and respond when you are ready.`,
        serviceName: service.name,
        bookingId: booking.id,
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
    );

    return this.present(booking, user.id);
  }

  // ---------- status changes ----------

  /**
   * Moves a booking to a new status if the caller is allowed to.
   *
   * The update only succeeds if the status is still what we read,
   * so two taps or two people cannot apply the same step twice.
   */
  private async move(
    user: AuthUser,
    id: string,
    to: ServiceBookingStatus,
    data: Prisma.ServiceBookingUpdateManyMutationInput = {},
  ) {
    const booking = await this.loadFor(user, id);
    const role =
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
    );

    const price =
      dto.quotedPrice !== undefined
        ? money(dto.quotedPrice).toFixed(2)
        : undefined;

    await this.tell(
      booking.customerId,
      'Booking accepted',
      `${booking.service.name} was accepted.${
        price ? ` Quoted price: ₦${price}.` : ''
      }`,
      id,
    );

    await this.sendBookingEmail(
      booking.customerId,
      `Your booking was accepted: ${booking.service.name}`,
      {
        title: 'Booking accepted',
        message: `Good news! Your booking request for ${booking.service.name} has been accepted by the artisan.`,
        serviceName: booking.service.name,
        bookingId: id,
        details: price
          ? [`Quoted price: ₦${price}`]
          : [],
      },
    );

    return this.get(user, id);
  }

  // ---------- decline ----------

  async decline(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
  ) {
    const { booking } = await this.move(
      user,
      id,
      'DECLINED',
    );

    const reason = dto.reason?.trim();

    await this.tell(
      booking.customerId,
      'Booking declined',
      `${booking.service.name} was declined.${
        reason ? ` ${reason}` : ''
      }`,
      id,
    );

    await this.sendBookingEmail(
      booking.customerId,
      `Booking declined: ${booking.service.name}`,
      {
        title: 'Booking declined',
        message: `Unfortunately, your booking request for ${booking.service.name} was declined by the artisan.`,
        serviceName: booking.service.name,
        bookingId: id,
        details: reason ? [`Reason: ${reason}`] : [],
      },
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

    const { booking } = await this.move(
      user,
      id,
      'SCHEDULED',
      {
        scheduledAt,
      },
    );

    const formattedDate = scheduledAt.toLocaleString('en-NG', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    });

    await this.tell(
      booking.customerId,
      'Booking scheduled',
      `${booking.service.name} is set for ${formattedDate}.`,
      id,
    );

    await this.sendBookingEmail(
      booking.customerId,
      `Booking scheduled: ${booking.service.name}`,
      {
        title: 'Booking scheduled',
        message: `Your booking for ${booking.service.name} has been scheduled.`,
        serviceName: booking.service.name,
        bookingId: id,
        details: [
          `Scheduled date: ${formattedDate}`,
        ],
      },
    );

    return this.get(user, id);
  }

  // ---------- start ----------

  async start(user: AuthUser, id: string) {
    const { booking } = await this.move(
      user,
      id,
      'IN_PROGRESS',
    );

    await this.tell(
      booking.customerId,
      'Work has started',
      `${booking.service.name} is now in progress.`,
      id,
    );

    await this.sendBookingEmail(
      booking.customerId,
      `Work has started: ${booking.service.name}`,
      {
        title: 'Work has started',
        message: `The artisan has marked your ${booking.service.name} booking as in progress.`,
        serviceName: booking.service.name,
        bookingId: id,
      },
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

    const { booking } = await this.move(
      user,
      id,
      'COMPLETED',
      {
        completedAt: new Date(),
        ...(finalPrice ? { finalPrice } : {}),
      },
    );

    await this.tell(
      booking.customerId,
      'Job completed',
      `${booking.service.name} is done. How did it go? Leave a review.`,
      id,
    );

    await this.sendBookingEmail(
      booking.customerId,
      `Job completed: ${booking.service.name}`,
      {
        title: 'Your service is complete',
        message: `The artisan has marked your ${booking.service.name} booking as completed. You can now share your experience by leaving a review.`,
        serviceName: booking.service.name,
        bookingId: id,
        details: finalPrice
          ? [`Final price: ₦${finalPrice.toFixed(2)}`]
          : [],
      },
    );

    return this.get(user, id);
  }

  // ---------- cancel ----------

  async cancel(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
  ) {
    const { booking, role } = await this.move(
      user,
      id,
      'CANCELLED',
    );

    const otherSide =
      role === 'customer'
        ? booking.artisan.userId
        : booking.customerId;

    const reason = dto.reason?.trim();

    const message =
      `${booking.service.name} was cancelled by the ${role}.` +
      (reason ? ` ${reason}` : '');

    await this.tell(
      otherSide,
      'Booking cancelled',
      message,
      id,
    );

    await this.sendBookingEmail(
      otherSide,
      `Booking cancelled: ${booking.service.name}`,
      {
        title: 'Booking cancelled',
        message: `The ${role} has cancelled the booking for ${booking.service.name}.`,
        serviceName: booking.service.name,
        bookingId: id,
        details: [
          `Cancelled by: ${role}`,
          ...(reason ? [`Reason: ${reason}`] : []),
        ],
      },
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
    const items = hasMore
      ? rows.slice(0, limit)
      : rows;

    return {
      items: items.map((row) =>
        this.present(row, viewerId),
      ),
      nextCursor: hasMore
        ? items[items.length - 1].id
        : null,
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

      await this.prisma.serviceBooking.updateMany({
        where: {
          id: {
            in: stale.map((row) => row.id),
          },
          status: 'REQUESTED',
        },
        data: {
          status: 'CANCELLED',
        },
      });

      for (const row of stale) {
        const message =
          `Nobody answered your request for ${row.service.name}, ` +
          'so it was cancelled. You can book someone else.';

        await this.tell(
          row.customerId,
          'Booking request expired',
          message,
          row.id,
        );

        await this.sendBookingEmail(
          row.customerId,
          `Booking request expired: ${row.service.name}`,
          {
            title: 'Booking request expired',
            message: `Nobody answered your booking request for ${row.service.name} within the response period, so it has been cancelled. You can now find and book another artisan.`,
            serviceName: row.service.name,
            bookingId: row.id,
          },
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown expiry error';

      this.log.error(
        `Expiring requests failed: ${message}`,
      );
    }
  }
}