import { Module } from '@nestjs/common';
import { ArtisansController } from './artisans.controller';
import { ArtisansService } from './artisans.service';
import { BookingsService } from './bookings.service';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [ArtisansController],
  providers: [ArtisansService, BookingsService, ReviewsService],
  // Moderation needs this to refresh an average after hiding a review.
  exports: [ArtisansService],
})
export class ArtisansModule {}
