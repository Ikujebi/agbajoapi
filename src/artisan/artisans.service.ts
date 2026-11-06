import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  ArtisanQueryDto,
  CreateServiceDto,
  ProfileDto,
  UpdateServiceDto,
} from './dto/artisan.dto';

type Db = Prisma.TransactionClient | PrismaService;

const MAX_SERVICES = 20;
const DEFAULT_PAGE_SIZE = 20;

const PERSON = {
  id: true,
  firstName: true,
  otherNames: true,
  lastName: true,
  avatarUrl: true,
} as const;

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

@Injectable()
export class ArtisansService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- helpers ----------

  private async isBlocked(a: string, b: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    });

    return Boolean(block);
  }

  private async requireProfile(userId: string) {
    const profile = await this.prisma.artisanProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Create your artisan profile first.');
    }

    return profile;
  }

  /**
   * Recalculates an artisan's average from their published job reviews.
   * Call it after a review is added, hidden or restored.
   */
  async refreshRating(artisanUserId: string, db: Db = this.prisma) {
    const result = await db.review.aggregate({
      where: {
        targetUserId: artisanUserId,
        serviceBookingId: { not: null },
        status: 'PUBLISHED',
      },
      _avg: { rating: true },
    });

    await db.artisanProfile.updateMany({
      where: { userId: artisanUserId },
      data: {
        averageRating:
          result._avg.rating === null
            ? null
            : new Prisma.Decimal(result._avg.rating.toFixed(2)),
      },
    });
  }

  /** Used by moderation after a review is hidden. */
  async refreshRatingForReview(reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { targetUserId: true, serviceBookingId: true },
    });

    if (review?.targetUserId && review.serviceBookingId) {
      await this.refreshRating(review.targetUserId);
    }
  }

  // ---------- profile ----------

  async createProfile(user: AuthUser, dto: ProfileDto) {
    try {
      return await this.prisma.artisanProfile.create({
        data: {
          userId: user.id,
          headline: dto.headline?.trim(),
          bio: dto.bio?.trim(),
          yearsExperience: dto.yearsExperience,
          serviceArea: dto.serviceArea?.trim(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You already have an artisan profile.');
      }

      throw error;
    }
  }

  async updateProfile(user: AuthUser, dto: ProfileDto) {
    await this.requireProfile(user.id);

    return this.prisma.artisanProfile.update({
      where: { userId: user.id },
      data: {
        ...(dto.headline !== undefined ? { headline: dto.headline.trim() } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() } : {}),
        ...(dto.yearsExperience !== undefined
          ? { yearsExperience: dto.yearsExperience }
          : {}),
        ...(dto.serviceArea !== undefined
          ? { serviceArea: dto.serviceArea.trim() }
          : {}),
      },
    });
  }

  async myProfile(user: AuthUser) {
    const profile = await this.prisma.artisanProfile.findUnique({
      where: { userId: user.id },
      include: { services: { orderBy: { createdAt: 'desc' } } },
    });

    if (!profile) {
      throw new NotFoundException('Create your artisan profile first.');
    }

    return profile;
  }

  /** Platform admins mark trusted artisans as verified. */
  async setVerified(profileId: string, isVerified: boolean) {
    const result = await this.prisma.artisanProfile.updateMany({
      where: { id: profileId },
      data: { isVerified },
    });

    if (result.count === 0) {
      throw new NotFoundException('Artisan not found.');
    }

    return { id: profileId, isVerified };
  }

  // ---------- services ----------

  async addService(user: AuthUser, dto: CreateServiceDto) {
    const profile = await this.requireProfile(user.id);

    const count = await this.prisma.artisanService.count({
      where: { artisanProfileId: profile.id },
    });

    if (count >= MAX_SERVICES) {
      throw new BadRequestException(
        `You can list at most ${MAX_SERVICES} services.`,
      );
    }

    return this.prisma.artisanService.create({
      data: {
        artisanProfileId: profile.id,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        basePrice: dto.basePrice !== undefined ? money(dto.basePrice) : undefined,
      },
    });
  }

  private async ownService(user: AuthUser, id: string) {
    const service = await this.prisma.artisanService.findFirst({
      where: { id, artisanProfile: { userId: user.id } },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }

  async updateService(user: AuthUser, id: string, dto: UpdateServiceDto) {
    await this.ownService(user, id);

    return this.prisma.artisanService.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.basePrice !== undefined
          ? { basePrice: money(dto.basePrice) }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /**
   * Services are switched off, not deleted, because past bookings and their
   * reviews still point at them.
   */
  async removeService(user: AuthUser, id: string) {
    await this.ownService(user, id);

    await this.prisma.artisanService.update({
      where: { id },
      data: { isActive: false },
    });

    return { ok: true };
  }

  // ---------- browse ----------

  async search(user: AuthUser, query: ArtisanQueryDto) {
    const term = query.q?.trim();
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.ArtisanProfileWhereInput = {
      user: {
        isActive: true,
        blocksMade: { none: { blockedId: user.id } },
        blocksGot: { none: { blockerId: user.id } },
      },
      // Only artisans with something to book.
      services: { some: { isActive: true } },
      ...(term
        ? {
            OR: [
              { headline: { contains: term, mode: 'insensitive' } },
              { bio: { contains: term, mode: 'insensitive' } },
              {
                services: {
                  some: {
                    isActive: true,
                    name: { contains: term, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.serviceArea
        ? {
            serviceArea: {
              contains: query.serviceArea.trim(),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.minRating !== undefined
        ? { averageRating: { gte: query.minRating } }
        : {}),
      ...(query.verifiedOnly ? { isVerified: true } : {}),
    };

    const orderBy: Prisma.ArtisanProfileOrderByWithRelationInput[] =
      query.sort === 'jobs'
        ? [{ completedJobs: 'desc' }, { id: 'asc' }]
        : query.sort === 'newest'
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [
              { averageRating: { sort: 'desc', nulls: 'last' } },
              { completedJobs: 'desc' },
              { id: 'asc' },
            ];

    const rows = await this.prisma.artisanProfile.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        user: { select: PERSON },
        services: {
          where: { isActive: true },
          select: { id: true, name: true, basePrice: true },
          orderBy: { name: 'asc' },
          take: 5,
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async get(user: AuthUser, id: string) {
    const profile = await this.prisma.artisanProfile.findUnique({
      where: { id },
      include: {
        user: { select: { ...PERSON, isActive: true } },
        services: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (
      !profile ||
      !profile.user.isActive ||
      (profile.userId !== user.id && (await this.isBlocked(user.id, profile.userId)))
    ) {
      throw new NotFoundException('Artisan not found.');
    }

    const reviewWhere: Prisma.ReviewWhereInput = {
      targetUserId: profile.userId,
      serviceBookingId: { not: null },
      status: 'PUBLISHED',
    };

    const [reviewCount, recent] = await Promise.all([
      this.prisma.review.count({ where: reviewWhere }),
      this.prisma.review.findMany({
        where: reviewWhere,
        include: { author: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const { user: owner, ...rest } = profile;

    return {
      ...rest,
      user: {
        id: owner.id,
        firstName: owner.firstName,
        otherNames: owner.otherNames,
        lastName: owner.lastName,
        avatarUrl: owner.avatarUrl,
      },
      reviewCount,
      recentReviews: recent.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        // First name and last initial protect reviewers' privacy.
        authorName: `${review.author.firstName} ${review.author.lastName.charAt(0)}.`,
      })),
    };
  }
}