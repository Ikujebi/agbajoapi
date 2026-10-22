import { Injectable } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 3;

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(userId: string, purpose: OtpPurpose, code: string): string {
    return createHash('sha256')
      .update(`${userId}:${purpose}:${code}`)
      .digest('hex');
  }

  /**
   * Creates a 6-digit code and stores only its hash.
   * Returns the code to send, or null if the user asked for too many
   * codes in the last hour.
   */
  async issue(
    userId: string,
    purpose: OtpPurpose,
    channel: OtpChannel,
  ): Promise<string | null> {
    const recent = await this.prisma.otpCode.count({
      where: {
        userId,
        purpose,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    if (recent >= OTP_MAX_PER_HOUR) return null;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.prisma.otpCode.create({
      data: {
        userId,
        purpose,
        channel,
        codeHash: this.hash(userId, purpose, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    return code;
  }

  /**
   * Checks the newest unused code. A correct code is consumed, so it works
   * once. Wrong guesses count against the code, and after 5 it is dead.
   */
  async consume(
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<boolean> {
    const now = new Date();

    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return false;

    const matches = timingSafeEqual(
      Buffer.from(otp.codeHash, 'hex'),
      Buffer.from(this.hash(userId, purpose, code), 'hex'),
    );

    if (!matches) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });

      return false;
    }

    const claimed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: now },
    });

    return claimed.count === 1;
  }
}
