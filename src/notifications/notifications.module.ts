import { Global, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { FcmService } from './fcm.service';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  controllers: [DevicesController],
  providers: [FcmService, NotificationsService, RealtimeGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
