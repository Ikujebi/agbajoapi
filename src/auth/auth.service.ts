import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OtpChannel, OtpPurpose, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms1/sms.service';
import { normalizePhone, tryNormalizePhone } from '../common/utils/phone';
import { LoginDto, RegisterDto } from './dto';
import { ChangePasswordDto, ResetPasswordDto } from './dto/password.dto';

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  avatarUrl: true,
  chatPrivacy: true,
  isSuperAdmin: true,
  createdAt: true,
} as const;

const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 3;
const INVALID_CODE = 'Invalid or expired code.';

/**
 * Compared against when the account does not exist, so a login for an
 * unknown user takes as long as one for a real user.
 */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

interface RefreshPayload {
  sub: string;
  jti: string;
}

const toPublicUser = (user: User) => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  chatPrivacy: user.chatPrivacy,
  isSuperAdmin: user.isSuperAdmin,
  createdAt: user.createdAt,
});

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private otpHash(userId: string, purpose: OtpPurpose, code: string): string {
    return this.hash(`${userId}:${purpose}:${code}`);
  }

  private hashesMatch(a: string, b: string): boolean {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  }

  /** Email (contains @) or phone in any common format. */
  private async findByIdentifier(identifier: string): Promise<User | null> {
    const value = identifier.trim();

    if (value.includes('@')) {
      return this.prisma.user.findUnique({
        where: { email: value.toLowerCase() },
      });
    }

    const phone = tryNormalizePhone(value);

    return phone ? this.prisma.user.findUnique({ where: { phone } }) : null;
  }

  private async issueTokens(userId: string) {
    const accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: accessSecret, expiresIn: '15m' },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti: randomUUID() },
      { secret: refreshSecret, expiresIn: '30d' },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
      },
    });

    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const phone = normalizePhone(dto.phone);
    const email = dto.email?.trim().toLowerCase() || undefined;

    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException('Phone or email already registered');
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          fullName: dto.fullName.trim(),
          phone,
          ...(email ? { email } : {}),
          passwordHash: await bcrypt.hash(dto.password, 10),
        },
        select: userSelect,
      });

      const tokens = await this.issueTokens(user.id);

      return { user, ...tokens };
    } catch (error) {
      // The unique constraints are the final protection against
      // simultaneous registrations with the same details.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Phone or email already registered');
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.findByIdentifier(dto.identifier);

    // Always run bcrypt, even for unknown accounts, to keep timing uniform.
    const passwordOk = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !user.isActive || !passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id);

    return { user: toPublicUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    let payload: RefreshPayload;

    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.jti !== 'string' ||
      !payload.jti
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hash(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.userId !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Delete conditionally so concurrent refresh attempts cannot
    // both successfully rotate the same stored token.
    const deleted = await this.prisma.refreshToken.deleteMany({
      where: {
        id: stored.id,
        tokenHash,
        userId: payload.sub,
        expiresAt: { gt: new Date() },
      },
    });

    if (deleted.count !== 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(payload.sub);
  }

  async logout(refreshToken: string) {
    if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
      return { ok: true };
    }

    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: this.hash(refreshToken) },
    });

    return { ok: true };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
  }

  // ---------- passwords ----------

  /**
   * Always answers the same way, whether or not the account exists,
   * so the endpoint cannot be used to find out who has an account.
   */
  async forgotPassword(identifier: string) {
    const response = {
      ok: true,
      message: 'If an account exists, a code has been sent.',
    };

    const user = await this.findByIdentifier(identifier);

    if (!user || !user.isActive) return response;

    const purpose = OtpPurpose.PASSWORD_RESET;
    const channel: OtpChannel = identifier.includes('@')
      ? OtpChannel.EMAIL
      : OtpChannel.SMS;

    const recent = await this.prisma.otpCode.count({
      where: {
        userId: user.id,
        purpose,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });

    if (recent >= OTP_MAX_PER_HOUR) return response;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        purpose,
        channel,
        codeHash: this.otpHash(user.id, purpose, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    try {
      if (channel === OtpChannel.EMAIL && user.email) {
        await this.mail.send(
          user.email,
          'Reset your password',
          `<p>Your password reset code is <b>${code}</b>.</p>` +
            `<p>It expires in 10 minutes. If you did not ask for it, ignore this email.</p>`,
        );
      } else {
        await this.sms.send(
          user.phone,
          `Your Neighborhood code is ${code}. It expires in 10 minutes. Never share it.`,
        );
      }
    } catch (error) {
      // The caller still gets the generic answer. Fix delivery from the logs.
      this.log.error(
        `Could not deliver reset code to user ${user.id}: ${(error as Error).message}`,
      );
    }

    return response;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.findByIdentifier(dto.identifier);

    if (!user || !user.isActive) {
      throw new BadRequestException(INVALID_CODE);
    }

    const purpose = OtpPurpose.PASSWORD_RESET;
    const now = new Date();

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException(INVALID_CODE);
    }

    if (!this.hashesMatch(otp.codeHash, this.otpHash(user.id, purpose, dto.code))) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });

      throw new BadRequestException(INVALID_CODE);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      // Claim the code so it can only be used once.
      const claimed = await tx.otpCode.updateMany({
        where: { id: otp.id, consumedAt: null },
        data: { consumedAt: now },
      });

      if (claimed.count !== 1) {
        throw new BadRequestException(INVALID_CODE);
      }

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      // Sign out every device.
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    });

    return { ok: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'The new password must be different from the current one.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    // Other devices are signed out. This device gets fresh tokens.
    return { ok: true, ...(await this.issueTokens(userId)) };
  }

  // ---------- housekeeping ----------

  /** Needs ScheduleModule.forRoot() in AppModule. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(): Promise<void> {
    try {
      const now = new Date();

      const tokens = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: now } },
      });

      const codes = await this.prisma.otpCode.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      });

      this.log.log(
        `Purged ${tokens.count} expired refresh token(s) and ${codes.count} old code(s)`,
      );
    } catch (error) {
      this.log.error(`Purge failed: ${(error as Error).message}`);
    }
  }
}