import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { hasPermission, Permission } from './permissions';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async check(
    user: AuthUser,
    organizationId: string,
    permission: Permission,
  ) {
    // Platform super admins pass every check (membership is null for them).
    if (user.isSuperAdmin) {
      return { allowed: true as const, membership: null };
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      include: { organization: { select: { type: true, isActive: true } } },
    });

    const allowed =
      !!membership &&
      membership.status === 'APPROVED' &&
      membership.organization.isActive &&
      hasPermission(membership.organization.type, membership.role, permission);

    return { allowed, membership: allowed ? membership : null };
  }

  /** Throws 403 unless the user holds the permission. Returns their membership. */
  async assert(user: AuthUser, organizationId: string, permission: Permission) {
    const result = await this.check(user, organizationId, permission);

    if (!result.allowed) {
      throw new ForbiddenException('You do not have permission to do this');
    }

    return result.membership;
  }

  /** Same check, but returns a boolean instead of throwing. */
  async can(
    user: AuthUser,
    organizationId: string,
    permission: Permission,
  ): Promise<boolean> {
    return (await this.check(user, organizationId, permission)).allowed;
  }
}