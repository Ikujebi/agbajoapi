import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { VisitorsModule } from './visitors/visitors.module';
import { ProductsModule } from './products/products.module';
import { ChatModule } from './chat/chat.module';
import { UsersModule } from './users/users.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { PermissionsModule } from './common/permissions/permissions.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { OrgHoursModule } from './org-hours/org-hours.module';
import {NoticesModule} from './notice/notices.module';
import { SosModule } from './sos/sos.module';
import {NotificationsModule} from './notifications/notifications.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Enable background cron jobs (e.g., unpaid order expiration)
    ScheduleModule.forRoot(),

    // Rate limit: 100 requests per 60 seconds by default.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    PrismaModule,
    MailModule,
    AuthModule,
    OrganizationsModule,
    VisitorsModule,
    ProductsModule,
    ChatModule,
    UsersModule,
    CloudinaryModule,
    PermissionsModule,
    OrdersModule,
    PaymentsModule,
    OrgHoursModule,
    NoticesModule,
    SosModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}