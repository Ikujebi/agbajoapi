
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface AuthenticatedRequest {
  user?: {
    id: string;
    isSuperAdmin: boolean;
  };
  params: Record<string, string | undefined>;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<
      import('@prisma/client').MembershipRole[]
    >(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Endpoints without @Roles() only require whatever other
    // guards have already required.
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const user = request.user;

    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.isSuperAdmin) {
      return true;
    }

    const organizationId = request.params.organizationId;

    if (!organizationId) {
      throw new InternalServerErrorException(
        'Organization role checks require an organizationId route parameter',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId,
        },
      },
      select: {
        role: true,
        status: true,
      },
    });

    if (
      !membership ||
      membership.status !== MembershipStatus.APPROVED ||
      !requiredRoles.includes(membership.role)
    ) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    return true;
  }
}
