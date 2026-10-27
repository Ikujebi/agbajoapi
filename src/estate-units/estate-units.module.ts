import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { EstateUnitsController } from './estate-units.controller';
import { EstateUnitsService } from './estate-units.service';

// If PrismaModule or PermissionsModule are not global in your app, import
// them here the same way VisitorsModule does.
@Module({
  imports: [OrganizationsModule],
  controllers: [EstateUnitsController],
  providers: [EstateUnitsService],
  exports: [EstateUnitsService],
})
export class EstateUnitsModule {}
