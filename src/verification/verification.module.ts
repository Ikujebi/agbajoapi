import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';


 import { PrismaModule } from '../prisma/prisma.module';
 import { OtpModule } from '../otp/otp.module';
 import { MailModule } from '../mail/mail.module';
import { SmsCampaignsModule } from '../sms-campaigns/sms-campaigns.module';
@Module({
  imports: [
     PrismaModule,
     OtpModule,
     MailModule,
     SmsCampaignsModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService], // Export if other modules need to use VerificationService
})
export class VerificationModule {}