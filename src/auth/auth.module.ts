
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import {OtpService} from '../otp/otp.service';
import {VerificationService} from '../verification/verification.service';
@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    OtpService,
    VerificationService,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
