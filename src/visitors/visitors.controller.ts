import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { VisitorsService } from './visitors.service';
import { CreatePassDto, VerifyPassDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('visitors')
export class VisitorsController {
  constructor(private visitors: VisitorsService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreatePassDto) { return this.visitors.create(u.id, dto); }
  @Get('mine') mine(@CurrentUser() u: AuthUser) { return this.visitors.mine(u.id); }
  @Patch(':id/revoke') revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.visitors.revoke(u.id, id); }

  @Post('verify') verify(@CurrentUser() u: AuthUser, @Body() dto: VerifyPassDto) { return this.visitors.verify(u.id, dto); }
  @Post('exit') exit(@CurrentUser() u: AuthUser, @Body() dto: VerifyPassDto) { return this.visitors.exit(u.id, dto); }
  @Get('log/:organizationId') log(@CurrentUser() u: AuthUser, @Param('organizationId') id: string) { return this.visitors.gateLog(u.id, id); }
}
