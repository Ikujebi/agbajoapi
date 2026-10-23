import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';

// Import PrismaModule if it is not global:
// import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    // PrismaModule,
  ],
  providers: [OtpService],
  exports: [OtpService], // Must be exported so VerificationModule can use it
})
export class OtpModule {}