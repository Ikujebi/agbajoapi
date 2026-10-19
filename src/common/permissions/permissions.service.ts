import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasPermission, Permission } from './permissions';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async assert(
    user: { id: string; isSuperAdmin?: boolean },
    organizationId: string,
    permission: Permission,
  ) {
    if (user.isSuperAdmin) return null;

    const m = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      include: { organization: { select: { type: true, isActive: true } } },
    });

    if (
      !m ||
      m.status !== 'APPROVED' ||
      !m.organization.isActive ||
      !hasPermission(m.organization.type, m.role, permission)
    ) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return m;
  }
}