
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';

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

interface RefreshPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(userId: string) {
    const accessSecret =
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret =
      this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: accessSecret,
        expiresIn: '15m',
      },
    );

    const refreshToken = await this.jwt.signAsync(
      {
        sub: userId,
        jti: randomUUID(),
      },
      {
        secret: refreshSecret,
        expiresIn: '30d',
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(
          Date.now() + REFRESH_TOKEN_LIFETIME_MS,
        ),
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async register(dto: RegisterDto) {
    const phone = dto.phone.trim();
    const email = dto.email?.trim().toLowerCase() || undefined;

    const exists = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone },
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException(
        'Phone or email already registered',
      );
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

      return {
        user,
        ...tokens,
      };
    } catch (error) {
      // The database unique constraints remain the final protection
      // against simultaneous registrations with the same details.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Phone or email already registered',
        );
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();

    const user = await this.prisma.user.findFirst({
      where: identifier.includes('@')
        ? { email: identifier.toLowerCase() }
        : { phone: identifier },
    });

    if (
      !user ||
      !user.isActive ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;
    const tokens = await this.issueTokens(user.id);

    return {
      user: safeUser,
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    if (
      typeof refreshToken !== 'string' ||
      refreshToken.trim().length === 0
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    let payload: RefreshPayload;

    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(
        refreshToken,
        {
          secret: this.config.getOrThrow<string>(
            'JWT_REFRESH_SECRET',
          ),
        },
      );
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
      select: {
        id: true,
        isActive: true,
      },
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
    if (
      typeof refreshToken !== 'string' ||
      refreshToken.trim().length === 0
    ) {
      return { ok: true };
    }

    await this.prisma.refreshToken.deleteMany({
      where: {
        tokenHash: this.hash(refreshToken),
      },
    });

    return { ok: true };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
  }
}
