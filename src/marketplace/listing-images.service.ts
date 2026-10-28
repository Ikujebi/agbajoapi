import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const MAX_IMAGES_PER_LISTING = 8;

@Injectable()
export class ListingImagesService {
  private readonly log = new Logger(ListingImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async loadOwned(user: AuthUser, listingId: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
    });

    if (!listing || listing.sellerId !== user.id) {
      throw new NotFoundException('Listing not found.');
    }

    if (listing.status === 'SOLD' || listing.status === 'REMOVED') {
      throw new BadRequestException('A closed listing cannot be changed.');
    }

    return listing;
  }

  async add(user: AuthUser, listingId: string, file: Express.Multer.File) {
    await this.loadOwned(user, listingId);

    const count = await this.prisma.listingImage.count({ where: { listingId } });

    if (count >= MAX_IMAGES_PER_LISTING) {
      throw new BadRequestException(
        `A listing can have at most ${MAX_IMAGES_PER_LISTING} photos.`,
      );
    }

    const uploaded = await this.cloudinary.uploadImage(
      file,
      `neighborhood/listings/${user.id}`,
    );

    try {
      return await this.prisma.listingImage.create({
        data: {
          listingId,
          url: uploaded.url,
          publicId: uploaded.publicId,
          sortOrder: count,
        },
      });
    } catch (error) {
      // Don't leave an orphaned file behind if the database write fails.
      await this.cloudinary.deleteAsset(uploaded.publicId).catch(() => {
        this.log.error(`Orphaned Cloudinary asset: ${uploaded.publicId}`);
      });

      throw error;
    }
  }

  async remove(user: AuthUser, listingId: string, imageId: string) {
    await this.loadOwned(user, listingId);

    const image = await this.prisma.listingImage.findFirst({
      where: { id: imageId, listingId },
    });

    if (!image) {
      throw new NotFoundException('Photo not found.');
    }

    await this.prisma.listingImage.delete({ where: { id: imageId } });

    if (image.publicId) {
      await this.cloudinary.deleteAsset(image.publicId).catch(() => {
        this.log.error(`Could not delete Cloudinary asset ${image.publicId}`);
      });
    }

    return { ok: true };
  }
}
