
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  MembershipRole,
  MembershipStatus,
  OrgType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  BroadcastEmailDto,
  CreateOrgDto,
  JoinOrgDto,
  ReviewMembershipDto,
} from './dto';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[char];
  });

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Requires an approved membership with one of the specified roles.
   */
  async assertRole(
    userId: string,
    organizationId: string,
    roles: MembershipRole[],
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    if (
      !membership ||
      membership.status !== MembershipStatus.APPROVED ||
      !roles.includes(membership.role)
    ) {
      throw new ForbiddenException(
        'You do not have permission to perform this action in this organization.',
      );
    }

    return membership;
  }

  async getOrThrow(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    return organization;
  }

  async create(userId: string, dto: CreateOrgDto) {
    try {
      return await this.prisma.organization.create({
        data: {
          ...dto,
          memberships: {
            create: {
              userId,
              role: MembershipRole.ORG_ADMIN,
              status: MembershipStatus.APPROVED,
            },
          },
        },
        include: {
          memberships: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An organization with the supplied unique details already exists.',
        );
      }

      throw error;
    }
  }

  async search(type?: OrgType, q?: string) {
    const term = q?.trim();

    return this.prisma.organization.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(term
          ? {
              name: {
                contains: term,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  async mine(userId: string) {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async join(userId: string, orgId: string, dto: JoinOrgDto) {
    const organization = await this.getOrThrow(orgId);

    if (organization.type === OrgType.SHOP) {
      throw new BadRequestException(
        'Shop organizations do not accept memberships through this endpoint.',
      );
    }

    const existing = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Membership already exists with status ${existing.status.toLowerCase()}.`,
      );
    }

    let membership;

    try {
      membership = await this.prisma.membership.create({
        data: {
          userId,
          organizationId: orgId,
          unit: dto.unit,
          status: MembershipStatus.PENDING,
          role:
            organization.type === OrgType.ESTATE
              ? MembershipRole.RESIDENT
              : MembershipRole.MEMBER,
        },
      });
    } catch (error: unknown) {
      // Another request may have created the membership concurrently.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You already have a membership or pending request for this organization.',
        );
      }

      throw error;
    }

    const admins = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        role: {
          in: [MembershipRole.ORG_ADMIN, MembershipRole.ORG_OWNER],
        },
        status: MembershipStatus.APPROVED,
      },
      select: { userId: true },
    });

    if (admins.length > 0) {
      await this.prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.userId,
          title: 'New join request',
          body: `A new user has requested to join ${organization.name}.`,
        })),
      });
    }

    return membership;
  }

  async listMembers(
    userId: string,
    orgId: string,
    status?: MembershipStatus,
  ) {
    await this.assertRole(userId, orgId, [
      MembershipRole.ORG_ADMIN,
      MembershipRole.ORG_OWNER,
    ]);

    return this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        ...(status ? { status } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async review(
    adminId: string,
    orgId: string,
    membershipId: string,
    dto: ReviewMembershipDto,
  ) {
    await this.assertRole(adminId, orgId, [
      MembershipRole.ORG_ADMIN,
      MembershipRole.ORG_OWNER,
    ]);

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId: orgId,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found.');
    }

    if (
      membership.userId === adminId &&
      (dto.status !== MembershipStatus.APPROVED ||
        (dto.role !== undefined && dto.role !== membership.role))
    ) {
      throw new BadRequestException(
        'You cannot demote yourself or change your own membership role through this endpoint.',
      );
    }

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: dto.status,
        ...(dto.role !== undefined ? { role: dto.role } : {}),
      },
    });

    const body =
      `Your membership of ${membership.organization.name} is now ` +
      `${dto.status.toLowerCase()}.`;

    await this.prisma.notification.create({
      data: {
        userId: membership.userId,
        title: 'Membership update',
        body,
      },
    });

    if (membership.user.email) {
      const safeBody = escapeHtml(body);

      // Don't let a mail provider failure undo the membership update.
      void this.mail
        .send(
          membership.user.email,
          'Membership update',
          `<p>${safeBody}</p>`,
        )
        .catch(() => undefined);
    }

    return updated;
  }

  async broadcastEmail(
    adminId: string,
    orgId: string,
    dto: BroadcastEmailDto,
  ) {
    await this.assertRole(adminId, orgId, [
      MembershipRole.ORG_ADMIN,
      MembershipRole.ORG_OWNER,
    ]);

    const organization = await this.getOrThrow(orgId);

    const members = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        status: MembershipStatus.APPROVED,
        user: {
          email: { not: null },
          isActive: true,
        },
      },
      select: {
        user: {
          select: { email: true },
        },
      },
    });

    const emails = members
      .map((membership) => membership.user.email)
      .filter((email): email is string => email !== null);

    const safeName = escapeHtml(organization.name);
    const safeBody = escapeHtml(dto.body).replace(/\r?\n/g, '<br/>');
    const html = `<h3>${safeName}</h3><div>${safeBody}</div>`;

    const sent = await this.mail.sendBulk(
      emails,
      `[${organization.name}] ${dto.subject}`,
      html,
    );

    await this.prisma.emailCampaign.create({
      data: {
        organizationId: orgId,
        senderId: adminId,
        subject: dto.subject,
        body: dto.body,
        recipientCount: sent,
      },
    });

    return {
      recipients: emails.length,
      sent,
    };
  }
}
