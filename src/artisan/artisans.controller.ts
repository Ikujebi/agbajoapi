import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { VerifiedPhoneGuard } from '../common/guards/verified-phone.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ArtisansService } from './artisans.service';
import { BookingsService } from './bookings.service';
import { ReviewsService } from './reviews.service';
import {
  AcceptBookingDto,
  ArtisanQueryDto,
  BookingQueryDto,
  CompleteBookingDto,
  CreateBookingDto,
  CreateServiceDto,
  ProfileDto,
  ReasonDto,
  ReviewDto,
  ReviewQueryDto,
  ScheduleBookingDto,
  UpdateServiceDto,
  VerifyArtisanDto,
} from './dto/artisan.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ArtisansController {
  constructor(
    private readonly artisans: ArtisansService,
    private readonly bookings: BookingsService,
    private readonly reviews: ReviewsService,
  ) {}

  // ---------- my artisan profile ----------

  /** Offering services needs a verified phone, so customers can reach you. */
  @UseGuards(VerifiedPhoneGuard)
  @Post('artisans/profile')
  createProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    return this.artisans.createProfile(user, dto);
  }

  @Patch('artisans/profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    return this.artisans.updateProfile(user, dto);
  }

  @Get('artisans/profile/mine')
  myProfile(@CurrentUser() user: AuthUser) {
    return this.artisans.myProfile(user);
  }

  // ---------- my services ----------

  @Post('artisans/services')
  addService(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceDto) {
    return this.artisans.addService(user, dto);
  }

  @Patch('artisans/services/:id')
  updateService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.artisans.updateService(user, id, dto);
  }

  @Delete('artisans/services/:id')
  removeService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.artisans.removeService(user, id);
  }

  // ---------- browsing ----------

  /** GET /api/artisans?q=&serviceArea=&minRating=&verifiedOnly=&sort=&cursor= */
  @Get('artisans')
  search(@CurrentUser() user: AuthUser, @Query() query: ArtisanQueryDto) {
    return this.artisans.search(user, query);
  }

  @Get('artisans/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.artisans.get(user, id);
  }

  @Get('artisans/:id/reviews')
  listReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviews.list(id, query);
  }

  // ---------- customer: booking ----------

  /** POST /api/artisans/services/:id/bookings */
  @UseGuards(VerifiedPhoneGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('artisans/services/:id/bookings')
  book(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookings.create(user, id, dto);
  }

  /** Declared before :id so "mine" and "received" are not read as ids. */
  @Get('bookings/mine')
  myBookings(@CurrentUser() user: AuthUser, @Query() query: BookingQueryDto) {
    return this.bookings.mine(user, query);
  }

  @Get('bookings/received')
  receivedBookings(
    @CurrentUser() user: AuthUser,
    @Query() query: BookingQueryDto,
  ) {
    return this.bookings.received(user, query);
  }

  @Get('bookings/:id')
  getBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookings.get(user, id);
  }

  // ---------- status changes ----------

  @Post('bookings/:id/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptBookingDto,
  ) {
    return this.bookings.accept(user, id, dto);
  }

  @Post('bookings/:id/decline')
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.bookings.decline(user, id, dto);
  }

  @Post('bookings/:id/schedule')
  schedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleBookingDto,
  ) {
    return this.bookings.schedule(user, id, dto);
  }

  @Post('bookings/:id/start')
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.start(user, id);
  }

  @Post('bookings/:id/complete')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteBookingDto,
  ) {
    return this.bookings.complete(user, id, dto);
  }

  @Post('bookings/:id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.bookings.cancel(user, id, dto);
  }

  // ---------- reviews ----------

  /** POST /api/bookings/:id/review  { rating: 1-5, comment? } */
  @Post('bookings/:id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.reviews.create(user, id, dto);
  }

  // ---------- platform admins ----------

  @UseGuards(SuperAdminGuard)
  @Patch('admin/artisans/:id/verify')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyArtisanDto,
  ) {
    return this.artisans.setVerified(id, dto.isVerified);
  }
}
