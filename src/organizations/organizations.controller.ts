import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrgType } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { OrganizationsService } from './organizations.service';
import { BroadcastEmailDto, CreateOrgDto, JoinOrgDto, ReviewMembershipDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private orgs: OrganizationsService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrgDto) { return this.orgs.create(u.id, dto); }

  @Get() search(@Query('type') type?: OrgType, @Query('q') q?: string) { return this.orgs.search(type, q); }

  @Get('mine') mine(@CurrentUser() u: AuthUser) { return this.orgs.mine(u.id); }

  @Get(':id') get(@Param('id') id: string) { return this.orgs.getOrThrow(id); }

  @Post(':id/join')
  join(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: JoinOrgDto) {
    return this.orgs.join(u.id, id, dto);
  }

  @Get(':id/members')
  members(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('status') status?: string) {
    return this.orgs.listMembers(u.id, id, status);
  }

  @Patch(':id/members/:membershipId')
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('membershipId') mid: string, @Body() dto: ReviewMembershipDto) {
    return this.orgs.review(u.id, id, mid, dto);
  }

  @Post(':id/broadcast-email')
  broadcast(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: BroadcastEmailDto) {
    return this.orgs.broadcastEmail(u.id, id, dto);
  }
}
