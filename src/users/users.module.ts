import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({ imports: [OrganizationsModule], providers: [UsersService], controllers: [UsersController] })
export class UsersModule {}
