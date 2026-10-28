import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ListingStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateListingDto,
  ListingQueryDto,
  UpdateListingDto,
} from './dto/marketplace.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_ACTIVE_PER_USER = 20;
const DEFAULT_PAGE_SIZE = 20;

/** Which status changes a seller may make. SOLD and REMOVED are final. */
const ALLOWED: Record<ListingStatus, ListingStatus[]> = {
  DRAFT: ['ACTIVE', 'REMOVED'],
  ACTIVE: ['DRAFT', 'RESERVED', 'SOLD', 'REMOVED'],
  RESERVED: ['ACTIVE', 'SOLD', 'REMOVED'],
  SOLD: [],
  REMOVED: [],
  EXPIRED: ['REMOVED'],
};

const SELLER_SELECT = {
  id: true,
  firstName: true,
  otherNames: true,
  lastName: true,
  avatarUrl: true,
} as const;

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

@Injectable()
export class ListingsService {
  private readonly log = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- helpers ----------

  private async assertRefs(categoryId?: string, neighborhoodId?: string) {
    if (categoryId) {
      const category = await this.prisma.marketplaceCategory.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });

      if (!category) throw new BadRequestException('Category not found.');
    }

    if (neighborhoodId) {
      const neighborhood = await this.prisma.neighborhood.findFirst({
        where: { id: neighborhoodId, isActive: true },
        select: { id: true },
      });

      if (!neighborhood) throw new BadRequestException('Neighborhood not found.');
    }
  }

  /** Stops one account from flooding the marketplace. */
  private async assertCapacity(userId: string) {
    const live = await this.prisma.marketplaceListing.count({
      where: { sellerId: userId, status: { in: ['ACTIVE', 'RESERVED'] } },
    });

    if (live >= MAX_ACTIVE_PER_USER) {
      throw new BadRequestException(
        `You can have at most ${MAX_ACTIVE_PER_USER} active listings. Mark some as sold or remove them first.`,
      );
    }
  }

  private async loadOwned(user: AuthUser, id: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id },
    });

    if (!listing || listing.sellerId !== user.id) {
      throw new NotFoundException('Listing not found.');
    }

    return listing;
  }

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

  /** Deletes a listing's photos from the database and from Cloudinary. */
  private async cleanupImages(listingId: string) {
    const images = await this.prisma.listingImage.findMany({
      where: { listingId },
      select: { publicId: true },
    });

    await this.prisma.listingImage.deleteMany({ where: { listingId } });

    for (const image of images) {
      if (!image.publicId) continue;

      await this.cloudinary.deleteAsset(image.publicId).catch(() => {
        this.log.error(`Could not delete Cloudinary asset ${image.publicId}`);
      });
    }
  }

  // ---------- create / read ----------

  async create(user: AuthUser, dto: CreateListingDto) {
    await this.assertRefs(dto.categoryId, dto.neighborhoodId);

    const status = dto.status ?? ListingStatus.ACTIVE;

    if (status === ListingStatus.ACTIVE) {
      await this.assertCapacity(user.id);
    }

    let neighborhoodId = dto.neighborhoodId;

    if (!neighborhoodId) {
      const primary = await this.prisma.userNeighborhood.findFirst({
        where: { userId: user.id, isPrimary: true },
        select: { neighborhoodId: true },
      });

      neighborhoodId = primary?.neighborhoodId;
    }

    return this.prisma.marketplaceListing.create({
      data: {
        sellerId: user.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        price: money(dto.price),
        condition: dto.condition,
        isNegotiable: dto.isNegotiable,
        locationText: dto.locationText?.trim(),
        categoryId: dto.categoryId,
        neighborhoodId,
        status,
        expiresAt: new Date(Date.now() + (dto.expiresInDays ?? DEFAULT_DAYS) * DAY_MS),
      },
      include: { images: true },
    });
  }

  /** Browse and search live listings, newest first by default. */
  async search(user: AuthUser, query: ListingQueryDto) {
    const term = query.q?.trim();
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    let categoryIds: string[] | undefined;

    if (query.categoryId) {
      const children = await this.prisma.marketplaceCategory.findMany({
        where: { parentId: query.categoryId },
        select: { id: true },
      });

      categoryIds = [query.categoryId, ...children.map((child) => child.id)];
    }

    const where: Prisma.MarketplaceListingWhereInput = {
      status: { in: ['ACTIVE', 'RESERVED'] },
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ...(term
          ? [
              {
                OR: [
                  { title: { contains: term, mode: 'insensitive' as const } },
                  { description: { contains: term, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
      // Hide sellers who are inactive or who have blocked, or been blocked by, the viewer.
      seller: {
        isActive: true,
        blocksMade: { none: { blockedId: user.id } },
        blocksGot: { none: { blockerId: user.id } },
      },
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.neighborhoodId ? { neighborhoodId: query.neighborhoodId } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.condition ? { condition: query.condition } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            price: {
              ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
              ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
            },
          }
        : {}),
    };

    const orderBy: Prisma.MarketplaceListingOrderByWithRelationInput[] =
      query.sort === 'price_asc'
        ? [{ price: 'asc' }, { id: 'asc' }]
        : query.sort === 'price_desc'
          ? [{ price: 'desc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }];

    const rows = await this.prisma.marketplaceListing.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        seller: { select: SELLER_SELECT },
        category: { select: { id: true, name: true } },
        neighborhood: { select: { id: true, name: true } },
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
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        seller: { select: { ...SELLER_SELECT, isActive: true } },
        category: { select: { id: true, name: true } },
        neighborhood: { select: { id: true, name: true } },
        _count: { select: { inquiries: true } },
      },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found.');
    }

    const isMine = listing.sellerId === user.id;

    if (!isMine && !user.isSuperAdmin) {
      const visible =
        ['ACTIVE', 'RESERVED', 'SOLD'].includes(listing.status) &&
        listing.seller.isActive &&
        !(
          ['ACTIVE', 'RESERVED'].includes(listing.status) &&
          listing.expiresAt &&
          listing.expiresAt < new Date()
        ) &&
        !(await this.isBlocked(user.id, listing.sellerId));

      if (!visible) {
        throw new NotFoundException('Listing not found.');
      }
    }

    const { _count, seller, ...rest } = listing;

    return {
      ...rest,
      seller: {
        id: seller.id,
        firstName: seller.firstName,
        otherNames: seller.otherNames,
        lastName: seller.lastName,
        avatarUrl: seller.avatarUrl,
      },
      isMine,
      // Only the seller sees how many people have asked.
      inquiryCount: isMine ? _count.inquiries : undefined,
    };
  }

  mine(user: AuthUser) {
    return this.prisma.marketplaceListing.findMany({
      where: { sellerId: user.id, status: { not: 'REMOVED' } },
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        _count: { select: { inquiries: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---------- change ----------

  async update(user: AuthUser, id: string, dto: UpdateListingDto) {
    const listing = await this.loadOwned(user, id);

    if (listing.status === 'SOLD' || listing.status === 'REMOVED') {
      throw new BadRequestException('A closed listing cannot be edited.');
    }

    if (listing.status === 'EXPIRED' && dto.status !== 'REMOVED') {
      throw new BadRequestException('Renew an expired listing to edit it.');
    }

    await this.assertRefs(dto.categoryId, dto.neighborhoodId);

    const changingStatus = dto.status !== undefined && dto.status !== listing.status;

    if (changingStatus && !ALLOWED[listing.status].includes(dto.status!)) {
      throw new BadRequestException(
        `A ${listing.status.toLowerCase()} listing cannot become ${dto.status!.toLowerCase()}.`,
      );
    }

    const publishing = changingStatus && dto.status === 'ACTIVE' && listing.status === 'DRAFT';

    if (publishing) {
      await this.assertCapacity(user.id);
    }

    const updated = await this.prisma.marketplaceListing.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.price !== undefined ? { price: money(dto.price) } : {}),
        ...(dto.condition !== undefined ? { condition: dto.condition } : {}),
        ...(dto.isNegotiable !== undefined ? { isNegotiable: dto.isNegotiable } : {}),
        ...(dto.locationText !== undefined
          ? { locationText: dto.locationText.trim() }
          : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.neighborhoodId !== undefined
          ? { neighborhoodId: dto.neighborhoodId }
          : {}),
        ...(changingStatus ? { status: dto.status } : {}),
        // A draft that is published starts a fresh listing period.
        ...(publishing
          ? { expiresAt: new Date(Date.now() + DEFAULT_DAYS * DAY_MS) }
          : {}),
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });

    if (changingStatus && dto.status === 'REMOVED') {
      await this.cleanupImages(id);
    }

    return updated;
  }

  /** Extends a listing by another 30 days, and revives an expired one. */
  async renew(user: AuthUser, id: string) {
    const listing = await this.loadOwned(user, id);

    if (!['ACTIVE', 'RESERVED', 'EXPIRED'].includes(listing.status)) {
      throw new BadRequestException('Only live or expired listings can be renewed.');
    }

    if (listing.status === 'EXPIRED') {
      await this.assertCapacity(user.id);
    }

    return this.prisma.marketplaceListing.update({
      where: { id },
      data: {
        status: listing.status === 'EXPIRED' ? 'ACTIVE' : listing.status,
        expiresAt: new Date(Date.now() + DEFAULT_DAYS * DAY_MS),
      },
    });
  }

  /** The seller or a platform admin takes a listing down. */
  async remove(user: AuthUser, id: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id },
    });

    if (!listing || (listing.sellerId !== user.id && !user.isSuperAdmin)) {
      throw new NotFoundException('Listing not found.');
    }

    await this.prisma.marketplaceListing.update({
      where: { id },
      data: { status: 'REMOVED' },
    });

    await this.cleanupImages(id);

    return { ok: true };
  }

  // ---------- inquiries ----------

  async inquire(user: AuthUser, listingId: string, message: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        sellerId: true,
        status: true,
        expiresAt: true,
        seller: { select: { isActive: true } },
      },
    });

    const live =
      listing &&
      ['ACTIVE', 'RESERVED'].includes(listing.status) &&
      listing.seller.isActive &&
      (!listing.expiresAt || listing.expiresAt > new Date());

    if (!listing || !live) {
      throw new NotFoundException('Listing not found.');
    }

    if (listing.sellerId === user.id) {
      throw new BadRequestException('You cannot send an inquiry on your own listing.');
    }

    if (await this.isBlocked(user.id, listing.sellerId)) {
      throw new ForbiddenException('You cannot contact this seller.');
    }

    const recent = await this.prisma.listingInquiry.count({
      where: {
        listingId,
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - DAY_MS) },
      },
    });

    if (recent >= 3) {
      throw new HttpException(
        'You have already contacted this seller a few times today. Please wait for a reply.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const inquiry = await this.prisma.listingInquiry.create({
      data: { listingId, userId: user.id, message: message.trim() },
    });

    await this.notifications.send([listing.sellerId], {
      type: 'GENERAL',
      title: `New inquiry: ${listing.title}`,
      body: inquiry.message.slice(0, 120),
      data: { listingId, inquiryId: inquiry.id, buyerId: user.id },
    });

    return inquiry;
  }

  async inquiries(user: AuthUser, listingId: string) {
    await this.loadOwned(user, listingId);

    return this.prisma.listingInquiry.findMany({
      where: { listingId },
      include: { user: { select: SELLER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---------- housekeeping ----------

  /** Marks listings past their end date as EXPIRED and tells the sellers. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireListings(): Promise<void> {
    try {
      const due = await this.prisma.marketplaceListing.findMany({
        where: {
          status: { in: ['ACTIVE', 'RESERVED'] },
          expiresAt: { lt: new Date() },
        },
        select: { id: true, sellerId: true },
        take: 500,
      });

      if (due.length === 0) return;

      await this.prisma.marketplaceListing.updateMany({
        where: {
          id: { in: due.map((listing) => listing.id) },
          status: { in: ['ACTIVE', 'RESERVED'] },
        },
        data: { status: 'EXPIRED' },
      });

      const perSeller = new Map<string, number>();

      for (const listing of due) {
        perSeller.set(listing.sellerId, (perSeller.get(listing.sellerId) ?? 0) + 1);
      }

      for (const [sellerId, count] of perSeller) {
        await this.notifications.send([sellerId], {
          type: 'GENERAL',
          title: 'Listings expired',
          body: `${count} of your listing${count === 1 ? ' has' : 's have'} expired. Renew ${count === 1 ? 'it' : 'them'} to keep selling.`,
        });
      }
    } catch (error) {
      this.log.error(`Listing expiry failed: ${(error as Error).message}`);
    }
  }
}
