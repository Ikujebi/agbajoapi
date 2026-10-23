import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ChurchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The organization must exist, be active, and be a church or mosque. */
  async assertWorship(organizationId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true, isActive: true },
    });

    if (!org || !org.isActive) {
      throw new NotFoundException('Organization not found.');
    }

    if (org.type !== 'CHURCH' && org.type !== 'MOSQUE') {
      throw new BadRequestException(
        'This feature is only available for churches and mosques.',
      );
    }
  }

  async isApprovedMember(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { status: true },
    });

    return membership?.status === 'APPROVED';
  }

  /** The caller must be an approved member (platform super admins pass). */
  async assertMember(user: AuthUser, organizationId: string): Promise<void> {
    if (user.isSuperAdmin) return;

    if (!(await this.isApprovedMember(user.id, organizationId))) {
      throw new ForbiddenException('Only approved members can do this.');
    }
  }

  /**
   * Church profile that giving, pledges and attendance hang off.
   * Created the first time it is needed, so approval needs no extra step.
   */
  ensureMember(userId: string, organizationId: string) {
    return this.prisma.churchMember.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      create: { userId, organizationId, joinedAt: new Date() },
      update: {},
    });
  }
}
