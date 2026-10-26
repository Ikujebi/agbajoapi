
import { Module } from '@nestjs/common';

import { WalletModule } from '../wallet/wallet.module';
import { SmsModule } from '../sms/sms.module';

import { SmsCampaignsController } from './sms-campaigns.controller';
import { SmsCampaignsService } from './sms-campaigns.service';

@Module({
  imports: [
    SmsModule,
    WalletModule,
  ],
  controllers: [SmsCampaignsController],
  providers: [SmsCampaignsService],
})
export class SmsCampaignsModule {}
