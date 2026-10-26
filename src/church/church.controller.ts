import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EventStatus, GivingType } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { PaymentsService } from '../payments/payments.service';
import { ChurchEventsService } from './church-events.service';
import { ChurchGivingService } from './dto/church-giving.service';
import {
  CreateEventDto,
  CreatePledgeDto,
  GiveOnlineDto,
  MarkAttendanceDto,
  RecordGivingDto,
  UpdateEventDto,
} from './dto/church.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ChurchController {
  constructor(
    private readonly events: ChurchEventsService,
    private readonly giving: ChurchGivingService,
    private readonly payments: PaymentsService,
  ) {}

  // ---------- events ----------

  @Post('organizations/:orgId/events')
  createEvent(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.events.create(user, orgId, dto);
  }

  @Get('organizations/:orgId/events')
  listEvents(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status', new ParseEnumPipe(EventStatus, { optional: true }))
    status?: EventStatus,
  ) {
    return this.events.list(user, orgId, status);
  }

  @Patch('events/:id')
  updateEvent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.update(user, id, dto);
  }

  @Post('events/:id/register')
  register(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.register(user, id);
  }

  @Delete('events/:id/register')
  unregister(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.unregister(user, id);
  }

  @Get('events/:id/registrations')
  registrations(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.registrations(user, id);
  }

  @Post('events/:id/attendance')
  markAttendance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.events.markAttendance(user, id, dto);
  }

  @Get('events/:id/attendance')
  attendance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.events.attendance(user, id);
  }

  // ---------- giving ----------

  /** Admin records cash or transfer received. */
  @Post('organizations/:orgId/giving')
  record(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: RecordGivingDto,
  ) {
    return this.giving.record(user, orgId, dto);
  }

  /** Member gives by card. Returns a Paystack link. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('organizations/:orgId/giving/online')
  giveOnline(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: GiveOnlineDto,
  ) {
    return this.payments.initializeGiving(user, orgId, dto);
  }

  @Get('organizations/:orgId/giving/mine')
  myGiving(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.giving.mine(user, orgId);
  }

  @Get('organizations/:orgId/giving/summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.giving.summary(user, orgId, from, to);
  }

  @Get('organizations/:orgId/giving')
  listGiving(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type', new ParseEnumPipe(GivingType, { optional: true }))
    type?: GivingType,
  ) {
    return this.giving.list(user, orgId, { from, to, type });
  }

  // ---------- pledges ----------

  @Post('organizations/:orgId/pledges')
  createPledge(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreatePledgeDto,
  ) {
    return this.giving.createPledge(user, orgId, dto);
  }

  @Get('organizations/:orgId/pledges/mine')
  myPledges(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.giving.myPledges(user, orgId);
  }

  @Get('organizations/:orgId/pledges')
  listPledges(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.giving.listPledges(user, orgId);
  }

  @Patch('pledges/:id/cancel')
  cancelPledge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.giving.cancelPledge(user, id);
  }
}
