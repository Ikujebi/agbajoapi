import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('search') search(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.users.search(u.id, q); }
  @Get('directory/:orgId') directory(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.users.directory(u.id, orgId); }
  @Get('notifications') notifications(@CurrentUser() u: AuthUser) { return this.users.notifications(u.id); }
  @Post('notifications/read-all') readAll(@CurrentUser() u: AuthUser) { return this.users.readAll(u.id); }
}
