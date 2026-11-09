
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

import { otpTemplate } from '../mail/templates';

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
        firstName: true,
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

  // ---------- PHONE VERIFICATION ----------

  async requestPhone(userId: string) {
    const user = await this.getUser(userId);

    if (!user.phone) {
      throw new BadRequestException(
        'Your account has no phone number.',
      );
    }

    if (user.phoneVerifiedAt) {
      return {
        ok: true,
        alreadyVerified: true,
      };
    }

    const code = await this.otp.issue(
      userId,
      OtpPurpose.VERIFY_PHONE,
      OtpChannel.SMS,
    );

    if (!code) {
      this.tooManyCodes();
    }

    try {
      await this.sms.send(
        user.phone,
        `Your AdugboHub verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
      );
    } catch (error) {
      this.log.error(
        `Could not send phone verification code to user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new ServiceUnavailableException(
        'We could not send the code. Please try again shortly.',
      );
    }

    return {
      ok: true,
      alreadyVerified: false,
    };
  }

  async confirmPhone(userId: string, code: string) {
    const user = await this.getUser(userId);

    if (user.phoneVerifiedAt) {
      return {
        ok: true,
        alreadyVerified: true,
      };
    }

    if (
      !(await this.otp.consume(
        userId,
        OtpPurpose.VERIFY_PHONE,
        code,
      ))
    ) {
      throw new BadRequestException(INVALID_CODE);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneVerifiedAt: new Date(),
      },
    });

    return {
      ok: true,
      alreadyVerified: false,
    };
  }

  // ---------- EMAIL VERIFICATION ----------

  async requestEmail(userId: string) {
    const user = await this.getUser(userId);

    if (!user.email) {
      throw new BadRequestException(
        'Your account has no email address.',
      );
    }

    if (user.emailVerifiedAt) {
      return {
        ok: true,
        alreadyVerified: true,
      };
    }

    const code = await this.otp.issue(
      userId,
      OtpPurpose.VERIFY_EMAIL,
      OtpChannel.EMAIL,
    );

    if (!code) {
      this.tooManyCodes();
    }

    try {
      const html = otpTemplate({
        recipientName: user.firstName || 'there',
        code,
         purpose: OtpPurpose.VERIFY_EMAIL,
      });

      const accepted = await this.mail.send(
        user.email,
        'Verify your AdugboHub email',
        html,
      );

      if (!accepted) {
        throw new Error(
          'Mail provider did not accept the verification email.',
        );
      }
    } catch (error) {
      this.log.error(
        `Could not send email verification code to user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new ServiceUnavailableException(
        'We could not send the code. Please try again shortly.',
      );
    }

    return {
      ok: true,
      alreadyVerified: false,
    };
  }

  async confirmEmail(userId: string, code: string) {
    const user = await this.getUser(userId);

    if (!user.email) {
      throw new BadRequestException(
        'Your account has no email address.',
      );
    }

    if (user.emailVerifiedAt) {
      return {
        ok: true,
        alreadyVerified: true,
      };
    }

    if (
      !(await this.otp.consume(
        userId,
        OtpPurpose.VERIFY_EMAIL,
        code,
      ))
    ) {
      throw new BadRequestException(INVALID_CODE);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: new Date(),
      },
    });

    return {
      ok: true,
      alreadyVerified: false,
    };
  }
}
