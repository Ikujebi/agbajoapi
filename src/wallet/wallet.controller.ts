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
import { IsNumber, Max, Min } from 'class-validator';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { PaymentsService } from '../payments/payments.service';
import { WalletService } from '../wallet/wallet.service';

export class TopupDto {
  /** Naira. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(500)
  @Max(500000)
  amount!: number;
}

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
  ) {}

  /** GET /api/organizations/:orgId/wallet: balance and the last 50 transactions. */
  @Get()
  overview(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.wallet.overview(user, orgId);
  }

  /**
   * POST /api/organizations/:orgId/wallet/topup  { amount }
   * Returns a Paystack link. The balance is credited once Paystack confirms
   * payment (webhook, or the status check after the redirect).
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('topup')
  topup(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: TopupDto,
  ) {
    return this.payments.initializeTopup(user, orgId, dto.amount);
  }
}
