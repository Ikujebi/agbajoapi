
import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

import { NotificationsModule } from '../notifications/notifications.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';

@Module({
  imports: [
    NotificationsModule,
    MarketplaceModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
