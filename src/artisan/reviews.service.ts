import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ArtisansService } from './artisans.service';
import { ReviewDto, ReviewQueryDto } from './dto/artisan.dto';

const REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artisans: ArtisansService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Only the customer of a completed job can review it, once, within 30 days.
   * That is what stops fake reviews. Reviews go live at once; abuse is handled
   * through reports, and hiding a review refreshes the artisan's average.
   */
  async create(user: AuthUser, bookingId: string, dto: ReviewDto) {
    const booking = await this.prisma.serviceBooking.findUnique({
      where: { id: bookingId },
      include: {
        artisan: { select: { userId: true } },
        review: { select: { id: true } },
        service: { select: { name: true } },
      },
    });

    if (!booking || booking.customerId !== user.id) {
      throw new NotFoundException('Booking not found.');
    }

    if (booking.status !== 'COMPLETED') {
      throw new BadRequestException(
        'You can review a job once the artisan has marked it completed.',
      );
    }

    if (booking.review) {
      throw new ConflictException('You have already reviewed this job.');
    }

    if (
      booking.completedAt &&
      Date.now() - booking.completedAt.getTime() > REVIEW_WINDOW_MS
    ) {
      throw new BadRequestException('The 30-day review window has closed.');
    }

    try {
      const review = await this.prisma.$transaction(async (tx) => {
        const created = await tx.review.create({
          data: {
            authorId: user.id,
            targetUserId: booking.artisan.userId,
            serviceBookingId: booking.id,
            rating: dto.rating,
            comment: dto.comment?.trim(),
            status: 'PUBLISHED',
          },
        });

        await this.artisans.refreshRating(booking.artisan.userId, tx);

        return created;
      });

      await this.notifications.send([booking.artisan.userId], {
        type: 'SERVICE_BOOKING',
        title: 'New review',
        body: `You received ${dto.rating} out of 5 for ${booking.service.name}.`,
        data: { bookingId, reviewId: review.id },
      });

      return review;
    } catch (error) {
      // Two taps at once: the unique booking link allows only one review.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already reviewed this job.');
      }

      throw error;
    }
  }

  /** Public reviews for an artisan, newest first. */
  async list(profileId: string, query: ReviewQueryDto) {
    const profile = await this.prisma.artisanProfile.findUnique({
      where: { id: profileId },
      select: { userId: true },
    });

    if (!profile) {
      throw new NotFoundException('Artisan not found.');
    }

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const rows = await this.prisma.review.findMany({
      where: {
        targetUserId: profile.userId,
        serviceBookingId: { not: null },
        status: 'PUBLISHED',
      },
      include: { author: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        authorName: `${review.author.firstName} ${review.author.lastName.charAt(0)}.`,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }
}
