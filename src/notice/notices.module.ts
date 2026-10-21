import { Module } from '@nestjs/common';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { NotificationsModule } from '@/notifications/notifications.module';

@Module({
  controllers: [NoticesController],
  providers: [NoticesService],
  imports: [
  // Keep your existing imports
  NotificationsModule,
],
})
export class NoticesModule {}
