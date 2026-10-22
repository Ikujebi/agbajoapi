import { ForbiddenException, Injectable } from '@nestjs/common';
import { ChatPrivacy, MembershipStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { tryNormalizePhone } from '../common/utils/phone';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search for users by name or phone number (any common format).
   * Excludes the current user, inactive accounts, users who accept messages
   * only from administrators, and anyone who has blocked, or been blocked
   * by, the searcher.
   */
  async search(userId: string, q?: string) {
    const term = q?.trim();

    if (!term || term.length < 3) {
      return [];
    }

    const phone = tryNormalizePhone(term);

    return this.prisma.user.findMany({
      where: {
        id: { not: userId },
        isActive: true,
        chatPrivacy: { not: ChatPrivacy.ADMINS_ONLY },
        blocksMade: { none: { blockedId: userId } },
        blocksGot: { none: { blockerId: userId } },
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
      },
      orderBy: { fullName: 'asc' },
      take: 20,
    });
  }

  /**
   * Approved members of an organization. Any approved member can see it;
   * outsiders and pending members cannot.
   */
  async directory(userId: string, orgId: string) {
    const own = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId, organizationId: orgId },
      },
      select: { status: true },
    });

    if (own?.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException(
        'Only approved members can view the member directory.',
      );
    }

    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        status: MembershipStatus.APPROVED,
        userId: { not: userId },
        user: { isActive: true },
      },
      select: {
        unit: true,
        role: true,
        title: true,
        user: {
          select: { id: true, fullName: true, avatarUrl: true },
        },
      },
      orderBy: { user: { fullName: 'asc' } },
      take: 500,
    });

    return rows.map((membership) => ({
      id: membership.user.id,
      fullName: membership.user.fullName,
      avatarUrl: membership.user.avatarUrl,
      unit: membership.unit,
      role: membership.role,
      title: membership.title,
    }));
  }

  /** The authenticated user's 100 most recent notifications. */
  async notifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** For the badge on the app's bell icon. */
  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });

    return { count };
  }

  /** Mark one notification as read. Other people's notifications are ignored. */
  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { ok: true };
  }

  /** Mark all of the user's unread notifications as read. */
  async readAll(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { ok: true, updatedCount: result.count };
  }
}