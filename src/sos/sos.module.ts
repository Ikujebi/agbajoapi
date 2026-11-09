
import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../common/permissions/permissions.module';

import { SosController } from './sos.controller';
import { SosService } from './sos.service';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    PermissionsModule,
  ],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
