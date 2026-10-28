import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { VerifiedContactGuard } from '../common/guards/verified-contact.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { ListingImagesService } from './listing-images.service';
import { ListingsService } from './listings.service';
import {
  CreateCategoryDto,
  CreateListingDto,
  InquiryDto,
  ListingQueryDto,
  UpdateListingDto,
} from './dto/marketplace.dto';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly listings: ListingsService,
    private readonly images: ListingImagesService,
  ) {}

  // ---------- categories ----------

  @Get('categories')
  categoryTree() {
    return this.categories.tree();
  }

  /** Platform super admin only. */
  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(user, dto);
  }

  /** Platform super admin only. */
  @Delete('categories/:id')
  removeCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categories.remove(user, id);
  }

  // ---------- listings ----------

  /** Selling needs a verified phone, so buyers can reach a real person. */
  @UseGuards(VerifiedContactGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('listings')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) {
    return this.listings.create(user, dto);
  }

  /** GET /api/marketplace/listings?q=&categoryId=&sort=&cursor= */
  @Get('listings')
  search(@CurrentUser() user: AuthUser, @Query() query: ListingQueryDto) {
    return this.listings.search(user, query);
  }

  /** Declared before :id so "mine" is not read as an id. */
  @Get('listings/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.listings.mine(user);
  }

  @Get('listings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.get(user, id);
  }

  @Patch('listings/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listings.update(user, id, dto);
  }

  @Post('listings/:id/renew')
  renew(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.renew(user, id);
  }

  @Delete('listings/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.remove(user, id);
  }

  // ---------- photos ----------

  /** POST /api/marketplace/listings/:id/images (multipart, field name "file") */
  @Post('listings/:id/images')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  addImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_BYTES }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp|avif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.images.add(user, id, file);
  }

  @Delete('listings/:id/images/:imageId')
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.images.remove(user, id, imageId);
  }

  // ---------- inquiries ----------

  /** A buyer asks the seller about a listing. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('listings/:id/inquiries')
  inquire(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InquiryDto,
  ) {
    return this.listings.inquire(user, id, dto.message);
  }

  /** The seller reads who has asked. */
  @Get('listings/:id/inquiries')
  inquiries(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listings.inquiries(user, id);
  }
}