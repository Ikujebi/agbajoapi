
import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { WalletModule } from '../wallet/wallet.module';
import { WalletController } from '../wallet/wallet.controller';

@Module({
  imports: [OrdersModule, WalletModule],
  providers: [PaymentsService],
  controllers: [PaymentsController, WalletController],
})
export class PaymentsModule {}
