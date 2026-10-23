import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { SmsCampaignsService } from './sms-campaigns.service';
import { SmsBroadcastDto } from './dto/sms-broadcast.dto';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/sms')
export class SmsCampaignsController {
  constructor(private readonly campaigns: SmsCampaignsService) {}

  /** POST /api/organizations/:orgId/sms/estimate: price and balance, no charge. */
  @Post('estimate')
  estimate(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SmsBroadcastDto,
  ) {
    return this.campaigns.estimate(user, orgId, dto);
  }

  /** POST /api/organizations/:orgId/sms: charges the wallet and sends. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  send(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SmsBroadcastDto,
  ) {
    return this.campaigns.send(user, orgId, dto);
  }

  /** GET /api/organizations/:orgId/sms: campaign history. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.campaigns.list(user, orgId);
  }
}
