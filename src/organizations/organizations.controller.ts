import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MembershipStatus, OrgType } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { OrganizationsService } from './organizations.service';
import {
  AddMemberDto,
  BroadcastEmailDto,
  CreateOrgDto,
  JoinOrgDto,
  ReviewMembershipDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrgDto) {
    return this.orgs.create(u.id, dto);
  }

  @Get()
  search(
    @Query('type', new ParseEnumPipe(OrgType, { optional: true }))
    type?: OrgType,
    @Query('q') q?: string,
  ) {
    return this.orgs.search(type, q);
  }

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.orgs.mine(u.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.getOrThrow(id);
  }

  @Post(':id/join')
  join(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JoinOrgDto,
  ) {
    return this.orgs.join(u.id, id, dto);
  }

  @Get(':id/members')
  members(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status', new ParseEnumPipe(MembershipStatus, { optional: true }))
    status?: MembershipStatus,
  ) {
    return this.orgs.listMembers(u, id, status);
  }

  /** Add someone directly by phone (shop attendants, estate security, ...). */
  @Post(':id/members')
  addMember(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.orgs.addMember(u, id, dto);
  }

  @Patch(':id/members/:membershipId')
  review(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) mid: string,
    @Body() dto: ReviewMembershipDto,
  ) {
    return this.orgs.review(u, id, mid, dto);
  }

  @Post(':id/broadcast-email')
  broadcast(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BroadcastEmailDto,
  ) {
    return this.orgs.broadcastEmail(u, id, dto);
  }
}