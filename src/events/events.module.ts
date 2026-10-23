import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PermissionsModule } from '../common/permissions/permissions.module';
// Adjust these module paths/names to the actual modules that export the services.
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [PrismaModule, OrganizationsModule, PermissionsModule, MailModule, SmsModule, CloudinaryModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
