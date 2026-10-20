import { Module } from '@nestjs/common';
import { OrgHoursController } from './org-hours.controller';
import { OrgHoursService } from './org-hours.service';

@Module({
  controllers: [OrgHoursController],
  providers: [OrgHoursService],
  exports: [OrgHoursService],
})
export class OrgHoursModule {}