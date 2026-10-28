
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

interface AuthenticatedRequest {
  user?: {
    id: string;
  };
}

@Injectable()
export class VerifiedContactGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        email: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const hasVerifiedEmail =
      Boolean(user.email) && user.emailVerifiedAt !== null;

    const hasVerifiedPhone = user.phoneVerifiedAt !== null;

    if (!hasVerifiedEmail && !hasVerifiedPhone) {
      throw new ForbiddenException(
        'Please verify your email address or phone number before creating a listing',
      );
    }

    return true;
  }
}
