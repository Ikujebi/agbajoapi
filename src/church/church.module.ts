import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ChurchAccessService } from './church-access.service';
import { ChurchEventsService } from './church-events.service';
import { ChurchGivingService } from './dto/church-giving.service';
import { ChurchController } from './church.controller';

@Module({
  // PaymentsModule must export PaymentsService.
  imports: [PaymentsModule],
  controllers: [ChurchController],
  providers: [ChurchAccessService, ChurchEventsService, ChurchGivingService],
})
export class ChurchModule {}
