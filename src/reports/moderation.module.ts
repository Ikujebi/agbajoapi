import { Module } from '@nestjs/common';
// MarketplaceModule must export ListingsService (see the note on the module).
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ArtisansModule } from '../artisan/artisans.module';

@Module({
  imports: [MarketplaceModule, ArtisansModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ModerationModule {}