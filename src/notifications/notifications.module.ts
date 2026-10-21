import { Global, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { FcmService } from './fcm.service';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [DevicesController],
  providers: [FcmService, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
