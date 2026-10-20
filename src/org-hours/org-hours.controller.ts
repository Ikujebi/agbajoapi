import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HoursKind } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { OrgHoursService } from './org-hours.service';
import { SetAcceptingOrdersDto, SetHoursDto } from './dto/set-hours.dto';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId')
export class OrgHoursController {
  constructor(private readonly hours: OrgHoursService) {}

  /** GET /api/organizations/:orgId/hours?kind=OPENING|VISITING */
  @Get('hours')
  get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('kind') kind?: string,
  ) {
    return this.hours.get(orgId, this.parseKind(kind));
  }

  /** PUT /api/organizations/:orgId/hours */
  @Put('hours')
  set(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SetHoursDto,
  ) {
    return this.hours.setHours(user, orgId, dto);
  }

  /** PATCH /api/organizations/:orgId/accepting-orders */
  @Patch('accepting-orders')
  setAccepting(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SetAcceptingOrdersDto,
  ) {
    return this.hours.setAcceptingOrders(user, orgId, dto.accepting);
  }

  private parseKind(kind?: string): HoursKind {
    if (!kind) return HoursKind.OPENING;

    if (!Object.values(HoursKind).includes(kind as HoursKind)) {
      throw new BadRequestException('kind must be OPENING or VISITING');
    }

    return kind as HoursKind;
  }
}