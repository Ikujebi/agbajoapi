import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export class RegisterDeviceDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token!: string;

  @IsIn(['android', 'ios', 'web'])
  platform!: string;
}

export class UnregisterDeviceDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /api/devices
   * Call after login and whenever the app receives a fresh FCM token.
   * If the token already belongs to another account (shared or resold
   * phone), it moves to the current user.
   */
  @Post()
  async register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId: user.id, token: dto.token, platform: dto.platform },
      update: { userId: user.id, platform: dto.platform },
    });

    return { ok: true };
  }

  /** POST /api/devices/unregister: call on logout so the phone stops receiving pushes. */
  @Post('unregister')
  @HttpCode(200)
  async unregister(
    @CurrentUser() user: AuthUser,
    @Body() dto: UnregisterDeviceDto,
  ) {
    await this.prisma.deviceToken.deleteMany({
      where: { token: dto.token, userId: user.id },
    });

    return { ok: true };
  }
}
