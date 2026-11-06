import { Module } from '@nestjs/common';
// MarketplaceModule must export ListingsService (see the note on the module).
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [MarketplaceModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ModerationModule {}