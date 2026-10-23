import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { OtpService } from '../otp/otp.service';

const INVALID_CODE = 'Invalid or expired code.';

@Injectable()
export class VerificationService {
  private readonly log = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  private tooManyCodes(): never {
    throw new HttpException(
      'Too many codes requested. Please try again in an hour.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ---------- phone ----------

  async requestPhone(userId: string) {
    const user = await this.getUser(userId);

    if (user.phoneVerifiedAt) {
      return { ok: true, alreadyVerified: true };
    }

    const code = await this.otp.issue(
      userId,
      OtpPurpose.VERIFY_PHONE,
      OtpChannel.SMS,
    );

    if (!code) this.tooManyCodes();

    try {
      await this.sms.send(
        user.phone,
        `Your Neighborhood verification code is ${code}. It expires in 10 minutes.`,
      );
    } catch (error) {
      this.log.error(
        `Could not send phone code to user ${userId}: ${(error as Error).message}`,
      );

      throw new ServiceUnavailableException(
        'We could not send the code. Please try again shortly.',
      );
    }

    return { ok: true, alreadyVerified: false };
  }

  async confirmPhone(userId: string, code: string) {
    const user = await this.getUser(userId);

    if (user.phoneVerifiedAt) {
      return { ok: true, alreadyVerified: true };
    }

    if (!(await this.otp.consume(userId, OtpPurpose.VERIFY_PHONE, code))) {
      throw new BadRequestException(INVALID_CODE);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { phoneVerifiedAt: new Date() },
    });

    return { ok: true, alreadyVerified: false };
  }

  // ---------- email ----------

  async requestEmail(userId: string) {
    const user = await this.getUser(userId);

    if (!user.email) {
      throw new BadRequestException('Your account has no email address.');
    }

    if (user.emailVerifiedAt) {
      return { ok: true, alreadyVerified: true };
    }

    const code = await this.otp.issue(
      userId,
      OtpPurpose.VERIFY_EMAIL,
      OtpChannel.EMAIL,
    );

    if (!code) this.tooManyCodes();

    try {
      await this.mail.send(
        user.email,
        'Verify your email',
        `<p>Your verification code is <b>${code}</b>.</p>` +
          `<p>It expires in 10 minutes. If you did not ask for it, ignore this email.</p>`,
      );
    } catch (error) {
      this.log.error(
        `Could not send email code to user ${userId}: ${(error as Error).message}`,
      );

      throw new ServiceUnavailableException(
        'We could not send the code. Please try again shortly.',
      );
    }

    return { ok: true, alreadyVerified: false };
  }

  async confirmEmail(userId: string, code: string) {
    const user = await this.getUser(userId);

    if (!user.email) {
      throw new BadRequestException('Your account has no email address.');
    }

    if (user.emailVerifiedAt) {
      return { ok: true, alreadyVerified: true };
    }

    if (!(await this.otp.consume(userId, OtpPurpose.VERIFY_EMAIL, code))) {
      throw new BadRequestException(INVALID_CODE);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });

    return { ok: true, alreadyVerified: false };
  }
}
