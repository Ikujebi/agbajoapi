
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { DevicesController } from './devices.controller';
import { FcmService } from './fcm.service';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';

import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [DevicesController],
  providers: [
    FcmService,
    NotificationsService,
    RealtimeGateway,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
