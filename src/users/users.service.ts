import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private orgs: OrganizationsService) {}

  /** Find people to chat with by name or exact phone. Users who accept admin-only messages are hidden. */
  async search(userId: string, q?: string) {
    const term = q?.trim();
    if (!term || term.length < 3) return [];
    return this.prisma.user.findMany({
      where: {
        id: { not: userId }, isActive: true, chatPrivacy: { not: 'ADMINS_ONLY' },
        OR: [{ fullName: { contains: term, mode: 'insensitive' } }, { phone: term }],
      },
      select: { id: true, fullName: true, avatarUrl: true },
      take: 20,
    });
  }

  /** Members of an organization, visible to its approved members. */
  async directory(userId: string, orgId: string) {
    await this.orgs.assertRole(userId, orgId, ['ORG_ADMIN', 'SECURITY', 'RESIDENT', 'MEMBER', 'STAFF']);
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: orgId, status: 'APPROVED', userId: { not: userId } },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return rows.map((m) => ({ id: m.user.id, fullName: m.user.fullName, unit: m.unit, role: m.role }));
  }

  notifications(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async readAll(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
