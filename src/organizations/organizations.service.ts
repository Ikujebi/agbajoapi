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
import { PermissionsService } from '../common/permissions/permissions.service';
import {
  TOP_ROLE,
  allowedRoles,
  rolesWith,
} from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  AddMemberDto,
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
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Legacy role check. Kept so older callers still compile.
   * New code should use PermissionsService.assert() instead.
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

  /**
   * Role changes must respect the organization type and the actor's rank.
   * actorRole === null means the actor is a platform super admin.
   */
  private assertCanAssign(
    orgType: OrgType,
    actorRole: MembershipRole | null,
    targetRole: MembershipRole,
    currentRole?: MembershipRole,
  ): void {
    if (!allowedRoles(orgType).includes(targetRole)) {
      throw new BadRequestException(
        `Role ${targetRole} is not available for ${orgType} organizations.`,
      );
    }

    const top = TOP_ROLE[orgType];
    const actorIsTop = actorRole === null || actorRole === top;

    if (!actorIsTop && (targetRole === top || currentRole === top)) {
      throw new ForbiddenException(
        `Only the ${top} can assign or change the ${top} role.`,
      );
    }
  }

  async create(userId: string, dto: CreateOrgDto) {
    try {
      return await this.prisma.organization.create({
        data: {
          ...dto,
          memberships: {
            create: {
              userId,
              role: TOP_ROLE[dto.type],
              status: MembershipStatus.APPROVED,
              joinedAt: new Date(),
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
        'Shops add their staff directly. Ask the owner or manager to add you.',
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
          // Residents are MEMBERs; the unit field records where they live.
          role: MembershipRole.MEMBER,
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

    // Notify everyone who is allowed to approve requests.
    const approvers = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        status: MembershipStatus.APPROVED,
        role: { in: rolesWith(organization.type, 'members.manage') },
      },
      select: { userId: true },
    });

    if (approvers.length > 0) {
      await this.prisma.notification.createMany({
        data: approvers.map((approver) => ({
          userId: approver.userId,
          title: 'New join request',
          body: `A new user has requested to join ${organization.name}.`,
        })),
      });
    }

    return membership;
  }

  /**
   * Directly add a user by phone number (shop attendants, estate security, ...).
   */
  async addMember(user: AuthUser, orgId: string, dto: AddMemberDto) {
    const organization = await this.getOrThrow(orgId);
    const actor = await this.permissions.assert(user, orgId, 'members.manage');

    this.assertCanAssign(organization.type, actor?.role ?? null, dto.role);

    const target = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true, isActive: true },
    });

    if (!target || !target.isActive) {
      throw new NotFoundException(
        'No active user found with that phone number.',
      );
    }

    try {
      const membership = await this.prisma.membership.create({
        data: {
          userId: target.id,
          organizationId: orgId,
          role: dto.role,
          title: dto.title,
          status: MembershipStatus.APPROVED,
          joinedAt: new Date(),
        },
      });

      await this.prisma.notification.create({
        data: {
          userId: target.id,
          title: 'Added to an organization',
          body: `You were added to ${organization.name} as ${dto.role
            .toLowerCase()
            .replace(/_/g, ' ')}.`,
        },
      });

      return membership;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'That user already has a membership in this organization.',
        );
      }

      throw error;
    }
  }

  async listMembers(
    user: AuthUser,
    orgId: string,
    status?: MembershipStatus,
  ) {
    await this.permissions.assert(user, orgId, 'members.view');

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
    user: AuthUser,
    orgId: string,
    membershipId: string,
    dto: ReviewMembershipDto,
  ) {
    const organization = await this.getOrThrow(orgId);
    const actor = await this.permissions.assert(user, orgId, 'members.manage');

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
      membership.userId === user.id &&
      (dto.status !== MembershipStatus.APPROVED ||
        (dto.role !== undefined && dto.role !== membership.role))
    ) {
      throw new BadRequestException(
        'You cannot demote yourself or change your own membership role through this endpoint.',
      );
    }

    // Runs even for status-only changes, so a manager cannot suspend the owner.
    this.assertCanAssign(
      organization.type,
      actor?.role ?? null,
      dto.role ?? membership.role,
      membership.role,
    );

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: dto.status,
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.status === MembershipStatus.APPROVED && !membership.joinedAt
          ? { joinedAt: new Date() }
          : {}),
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
    user: AuthUser,
    orgId: string,
    dto: BroadcastEmailDto,
  ) {
    await this.permissions.assert(user, orgId, 'email.broadcast');

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
        senderId: user.id,
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