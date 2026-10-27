import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { VisitorsService } from './visitors.service';

/**
 * Public (no login) endpoint behind the visitor's link:
 * GET /api/visitors/directions/:code
 *
 * Kept separate from VisitorsController, which is protected by JwtAuthGuard
 * at class level. ThrottlerGuard is already registered globally in AppModule,
 * so only the stricter limit is declared here.
 */
@Controller('visitors/directions')
export class VisitorDirectionsController {
  constructor(private readonly visitorsService: VisitorsService) {}

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Get(':code')
  directions(@Param('code') code: string) {
    return this.visitorsService.directions(code);
  }
}