import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SosStatus } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { SosService } from './sos.service';
import { TriggerSosDto } from './dto/sos.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class SosController {
  constructor(private readonly sos: SosService) {}

  /** POST /api/organizations/:orgId/sos */
  @Post('organizations/:orgId/sos')
  trigger(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: TriggerSosDto,
  ) {
    return this.sos.trigger(user, orgId, dto);
  }

  /** GET /api/organizations/:orgId/sos?status=OPEN (responders only) */
  @Get('organizations/:orgId/sos')
  list(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status') status?: string,
  ) {
    if (status && !Object.values(SosStatus).includes(status as SosStatus)) {
      throw new BadRequestException('Invalid status filter');
    }

    return this.sos.list(user, orgId, status as SosStatus | undefined);
  }

  /** GET /api/sos/mine */
  @Get('sos/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.sos.mine(user.id);
  }

  /** PATCH /api/sos/:id/acknowledge */
  @Patch('sos/:id/acknowledge')
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sos.acknowledge(user, id);
  }

  /** PATCH /api/sos/:id/resolve */
  @Patch('sos/:id/resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sos.resolve(user, id);
  }

  /** PATCH /api/sos/:id/cancel (the person who raised it) */
  @Patch('sos/:id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sos.cancel(user.id, id);
  }
}