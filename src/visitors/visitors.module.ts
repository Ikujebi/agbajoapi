
import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';
import {OrgHoursModule } from '../org-hours/org-hours.module';

@Module({
  imports: [OrganizationsModule, OrgHoursModule],
  controllers: [VisitorsController],
  providers: [VisitorsService],
  exports: [VisitorsService],
})
export class VisitorsModule {}
