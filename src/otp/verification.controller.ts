import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Matches } from 'class-validator';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';

export class ConfirmCodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('auth/verify')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  /** POST /api/auth/verify/phone/request: texts a 6-digit code. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('phone/request')
  requestPhone(@CurrentUser() user: AuthUser) {
    return this.verification.requestPhone(user.id);
  }

  /** POST /api/auth/verify/phone/confirm  { code } */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('phone/confirm')
  confirmPhone(@CurrentUser() user: AuthUser, @Body() dto: ConfirmCodeDto) {
    return this.verification.confirmPhone(user.id, dto.code);
  }

  /** POST /api/auth/verify/email/request: emails a 6-digit code. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('email/request')
  requestEmail(@CurrentUser() user: AuthUser) {
    return this.verification.requestEmail(user.id);
  }

  /** POST /api/auth/verify/email/confirm  { code } */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('email/confirm')
  confirmEmail(@CurrentUser() user: AuthUser, @Body() dto: ConfirmCodeDto) {
    return this.verification.confirmEmail(user.id, dto.code);
  }
}
