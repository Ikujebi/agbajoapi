
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ChatPrivacy,
  MembershipRole,
  MembershipStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
  ) {}

  /**
   * Search for users by name or exact phone number.
   * Excludes the current user, inactive accounts, and users
   * who allow messages only from administrators.
   */
  async search(userId: string, q?: string) {
    const term = q?.trim();

    if (!term || term.length < 3) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        id: { not: userId },
        isActive: true,
        chatPrivacy: {
          not: ChatPrivacy.ADMINS_ONLY,
        },
        OR: [
          {
            fullName: {
              contains: term,
              mode: 'insensitive',
            },
          },
          {
            phone: term,
          },
        ],
      },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
      },
      orderBy: {
        fullName: 'asc',
      },
      take: 20,
    });
  }

  /**
   * Return approved members of an organization.
   * Only authorized organization members can access the directory.
   */
  async directory(userId: string, orgId: string) {
    const allowedRoles: MembershipRole[] = [
      MembershipRole.ORG_OWNER,
      MembershipRole.ORG_ADMIN,
      MembershipRole.MANAGER,
      MembershipRole.SECURITY,
      MembershipRole.RESIDENT,
      MembershipRole.MEMBER,
      MembershipRole.STAFF,
    ];

    await this.orgs.assertRole(userId, orgId, allowedRoles);

    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        status: MembershipStatus.APPROVED,
        userId: {
          not: userId,
        },
        user: {
          isActive: true,
        },
      },
      select: {
        unit: true,
        role: true,
        user: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        user: {
          fullName: 'asc',
        },
      },
    });

    return rows.map((membership) => ({
      id: membership.user.id,
      fullName: membership.user.fullName,
      unit: membership.unit,
      role: membership.role,
    }));
  }

  /**
   * Return the authenticated user's notifications.
   */
  async notifications(userId: string) {
    return this.prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  }

  /**
   * Mark all unread notifications belonging to the user as read.
   */
  async readAll(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return {
      ok: true,
      updatedCount: result.count,
    };
  }
}
