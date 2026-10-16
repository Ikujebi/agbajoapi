import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { VisitorsService } from './visitors.service';
import { VisitorsController } from './visitors.controller';

@Module({ imports: [OrganizationsModule], providers: [VisitorsService], controllers: [VisitorsController] })
export class VisitorsModule {}
