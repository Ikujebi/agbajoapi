import {
  BadRequestException, Controller, Get, Headers, HttpCode, Logger, NotFoundException, Param, Post, RawBodyRequest, Req, UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  private readonly log = new Logger(PaymentsController.name);
  constructor(private payments: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderId/initialize')
  initialize(@CurrentUser() u: AuthUser, @Param('orderId') orderId: string) {
    return this.payments.initialize(u.id, orderId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify/:reference')
  verify(@CurrentUser() u: AuthUser, @Param('reference') reference: string) {
    return this.payments.status(u.id, reference);
  }

  /** Paystack calls this. Set the URL in the Paystack dashboard: https://YOUR_API/api/payments/webhook/paystack */
  @SkipThrottle()
  @HttpCode(200)
  @Post('webhook/paystack')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') signature?: string) {
    const raw = req.rawBody;
    if (!raw || !signature) throw new BadRequestException();

    const expected = createHmac('sha512', this.payments.secret).update(raw).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException('Invalid signature');

    const event = JSON.parse(raw.toString('utf8'));
    if (event.event === 'charge.success' && event.data?.reference) {
      try {
        await this.payments.settle(event.data.reference);
      } catch (e) {
        if (e instanceof NotFoundException) this.log.warn(`Webhook for unknown reference ${event.data.reference}`);
        else throw e; // non-200 makes Paystack retry
      }
    }
    return { received: true };
  }
}
