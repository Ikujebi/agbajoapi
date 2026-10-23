import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { SmsCampaignsController } from './sms-campaigns.controller';
import { SmsCampaignsService } from './sms-campaigns.service';

@Module({
  imports: [WalletModule],
  controllers: [SmsCampaignsController],
  providers: [SmsCampaignsService],
})
export class SmsCampaignsModule {}
