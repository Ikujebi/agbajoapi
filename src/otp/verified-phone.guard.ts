import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Use after JwtAuthGuard on actions that need a real, reachable person
 * (creating organizations, joining them, placing orders).
 *
 * Do NOT put this on SOS or anything safety-related.
 *
 * The 403 body carries code "PHONE_NOT_VERIFIED" so the app can send the
 * user to the verification screen.
 */
@Injectable()
export class VerifiedPhoneGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string; isSuperAdmin?: boolean } }>();

    const user = request.user;

    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.isSuperAdmin) return true;

    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { phoneVerifiedAt: true },
    });

    if (!row?.phoneVerifiedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Verify your phone number to continue.',
        code: 'PHONE_NOT_VERIFIED',
      });
    }

    return true;
  }
}
