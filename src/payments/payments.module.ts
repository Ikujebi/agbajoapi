import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({ imports: [OrdersModule], providers: [PaymentsService], controllers: [PaymentsController] })
export class PaymentsModule {}
