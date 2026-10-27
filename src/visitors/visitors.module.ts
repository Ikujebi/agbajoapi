
import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';
import {OrgHoursModule } from '../org-hours/org-hours.module';
import { VisitorDirectionsController } from './visitor-directions.controller';
import {MailModule} from '../mail/mail.module';
import {SmsModule} from '../sms/sms.module';
@Module({
  imports: [OrganizationsModule, OrgHoursModule, MailModule, SmsModule],
  controllers: [VisitorsController, VisitorDirectionsController],
  providers: [VisitorsService],
  exports: [VisitorsService],
})
export class VisitorsModule {}
