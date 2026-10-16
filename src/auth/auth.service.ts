import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';

const userSelect = {
  id: true, fullName: true, email: true, phone: true, avatarUrl: true,
  chatPrivacy: true, isSuperAdmin: true, createdAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService) {}

  private hash(t: string) {
    return createHash('sha256').update(t).digest('hex');
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti: randomUUID() },
      { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: '30d' },
    );
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hash(refreshToken), expiresAt: new Date(Date.now() + 30 * 86400000) },
    });
    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.phone }, ...(dto.email ? [{ email: dto.email.toLowerCase() }] : [])] },
    });
    if (exists) throw new ConflictException('Phone or email already registered');
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email?.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 10),
      },
      select: userSelect,
    });
    return { user, ...(await this.issueTokens(user.id)) };
  }

  async login(dto: LoginDto) {
    const id = dto.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: id.includes('@') ? { email: id.toLowerCase() } : { phone: id },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const { passwordHash, ...safe } = user;
    return { user: safe, ...(await this.issueTokens(user.id)) };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET') });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hash(refreshToken) } });
    if (!stored || stored.expiresAt < new Date()) throw new UnauthorizedException('Invalid refresh token');
    await this.prisma.refreshToken.delete({ where: { id: stored.id } }); // rotation
    return this.issueTokens(payload.sub);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash: this.hash(refreshToken) } });
    return { ok: true };
  }

  me(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  }
}
