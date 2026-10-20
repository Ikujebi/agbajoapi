import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import {OrgHoursModule } from '../org-hours/org-hours.module';
@Module({
  imports: [OrganizationsModule, OrgHoursModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
