
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('search')
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
  ) {
    return this.usersService.search(user.id, q);
  }

  @Get('directory/:orgId')
  directory(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.usersService.directory(user.id, orgId);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.usersService.notifications(user.id);
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.usersService.readAll(user.id);
  }
}
