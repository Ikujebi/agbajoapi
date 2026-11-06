
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  EmailCampaignStatus,
  MembershipRole,
  MembershipStatus,
  OrgType,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PermissionsService } from "../common/permissions/permissions.service";
import {
  TOP_ROLE,
  allowedRoles,
  rolesWith,
} from "../common/permissions/permissions";
import { AuthUser } from "../common/decorators/current-user.decorator";
import { normalizePhone } from "../common/utils/phone";
import {
  AddMemberDto,
  BroadcastEmailDto,
  CreateOrgDto,
  JoinOrgDto,
  ReviewMembershipDto,
} from "./dto";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Safely sends an email without allowing email failures
   * to interrupt the main organization operation.
   */
  private async sendEmailSafely(
    to: string | null | undefined,
    subject: string,
    html: string,
  ): Promise<void> {
    if (!to?.trim()) return;

    try {
      await this.mail.send(to.trim(), subject, html);
    } catch {
      // Email failures must not undo successful operations.
    }
  }

  /**
   * Builds a user's display name.
   */
  private formatUserName(user: {
    firstName?: string | null;
    otherNames?: string | null;
    lastName?: string | null;
  }): string {
    return [
      user.firstName,
      user.otherNames,
      user.lastName,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

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
        "You do not have permission to perform this action in this organization.",
      );
    }

    return membership;
  }

  async getOrThrow(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException("Organization not found.");
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
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "An organization with the supplied unique details already exists.",
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
                mode: "insensitive",
              },
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: 50,
    });
  }

  async mine(userId: string) {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Submit a request to join an organization.
   */
  async join(userId: string, orgId: string, dto: JoinOrgDto) {
    const organization = await this.getOrThrow(orgId);

    if (organization.type === OrgType.SHOP) {
      throw new BadRequestException(
        "Shops add their staff directly. Ask the owner or manager to add you.",
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
          role: MembershipRole.MEMBER,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "You already have a membership or pending request for this organization.",
        );
      }

      throw error;
    }

    // Notify everyone allowed to approve membership requests.
    const approvers = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        status: MembershipStatus.APPROVED,
        role: {
          in: rolesWith(organization.type, "members.manage"),
        },
      },
      select: { userId: true },
    });

    const approverIds = approvers.map((approver) => approver.userId);

    if (approverIds.length > 0) {
      await this.notifications.send(approverIds, {
        title: "New join request",
        body: `A new user has requested to join ${organization.name}.`,
        data: {
          organizationId: orgId,
          membershipId: membership.id,
        },
      });
    }

    // Confirm receipt of the request to the applicant.
    const applicant = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        otherNames: true,
        lastName: true,
        email: true,
      },
    });

    if (applicant?.email) {
      const name = this.formatUserName(applicant);
      const greeting = name
        ? `Hello ${escapeHtml(name)},`
        : "Hello,";

      const html = `
        <div>
          <p>${greeting}</p>
          <p>
            Your request to join
            <strong>${escapeHtml(organization.name)}</strong>
            has been received.
          </p>
          <p>
            An organization administrator will review your request.
            You will be notified when your membership status changes.
          </p>
          <p>Thank you.</p>
          <p>The AdugboHub Team</p>
        </div>
      `;

      await this.sendEmailSafely(
        applicant.email,
        `Join request received - ${organization.name}`,
        html,
      );
    }

    return membership;
  }

  /**
   * Directly add a user by phone number
   * (shop attendants, estate security, etc.).
   */
  async addMember(user: AuthUser, orgId: string, dto: AddMemberDto) {
    const organization = await this.getOrThrow(orgId);

    const actor = await this.permissions.assert(
      user,
      orgId,
      "members.manage",
    );

    this.assertCanAssign(
      organization.type,
      actor?.role ?? null,
      dto.role,
    );

    const target = await this.prisma.user.findUnique({
      where: {
        phone: normalizePhone(dto.phone),
      },
      select: {
        id: true,
        isActive: true,
        firstName: true,
        otherNames: true,
        lastName: true,
        email: true,
      },
    });

    if (!target || !target.isActive) {
      throw new NotFoundException(
        "No active user found with that phone number.",
      );
    }

    let membership;

    try {
      membership = await this.prisma.membership.create({
        data: {
          userId: target.id,
          organizationId: orgId,
          role: dto.role,
          title: dto.title,
          status: MembershipStatus.APPROVED,
          joinedAt: new Date(),
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "That user already has a membership in this organization.",
        );
      }

      throw error;
    }

    const roleLabel = dto.role
      .toLowerCase()
      .replace(/_/g, " ");

    const notificationBody =
      `You were added to ${organization.name} as ${roleLabel}.`;

    await this.notifications.send([target.id], {
      title: "Added to an organization",
      body: notificationBody,
      data: {
        organizationId: orgId,
        membershipId: membership.id,
      },
    });

    if (target.email) {
      const name = this.formatUserName(target);
      const greeting = name
        ? `Hello ${escapeHtml(name)},`
        : "Hello,";

      const html = `
        <div>
          <p>${greeting}</p>
          <p>
            You have been added to
            <strong>${escapeHtml(organization.name)}</strong>
            as <strong>${escapeHtml(roleLabel)}</strong>.
          </p>
          <p>
            You can now access the organization according to
            your assigned membership permissions.
          </p>
          <p>Welcome aboard!</p>
          <p>The AdugboHub Team</p>
        </div>
      `;

      await this.sendEmailSafely(
        target.email,
        `You've been added to ${organization.name}`,
        html,
      );
    }

    return membership;
  }

  async listMembers(
    user: AuthUser,
    orgId: string,
    status?: MembershipStatus,
  ) {
    await this.permissions.assert(user, orgId, "members.view");

    return this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        ...(status ? { status } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Approve, reject or otherwise review a membership request.
   */
  async review(
    user: AuthUser,
    orgId: string,
    membershipId: string,
    dto: ReviewMembershipDto,
  ) {
    const organization = await this.getOrThrow(orgId);

    const actor = await this.permissions.assert(
      user,
      orgId,
      "members.manage",
    );

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId: orgId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
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
      throw new NotFoundException("Membership not found.");
    }

    if (
      membership.userId === user.id &&
      (dto.status !== MembershipStatus.APPROVED ||
        (dto.role !== undefined &&
          dto.role !== membership.role))
    ) {
      throw new BadRequestException(
        "You cannot demote yourself or change your own membership role through this endpoint.",
      );
    }

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
        ...(dto.role !== undefined
          ? { role: dto.role }
          : {}),
        ...(dto.status === MembershipStatus.APPROVED &&
        !membership.joinedAt
          ? { joinedAt: new Date() }
          : {}),
      },
    });

    const body =
      `Your membership of ${membership.organization.name} is now ` +
      `${dto.status.toLowerCase()}.`;

    await this.notifications.send([membership.userId], {
      title: "Membership update",
      body,
      data: {
        organizationId: orgId,
        membershipId: membership.id,
      },
    });

    const name = this.formatUserName(membership.user);
    const greeting = name
      ? `Hello ${escapeHtml(name)},`
      : "Hello,";

    const html = `
      <div>
        <p>${greeting}</p>
        <p>
          Your membership of
          <strong>${escapeHtml(membership.organization.name)}</strong>
          is now
          <strong>${escapeHtml(dto.status.toLowerCase())}</strong>.
        </p>
        ${
          dto.status === MembershipStatus.APPROVED
            ? `
              <p>
                Your membership has been approved. You can now
                access the organization according to your assigned role.
              </p>
            `
            : dto.status === MembershipStatus.REJECTED
              ? `
                <p>
                  Your membership request was not approved.
                  Please contact the organization administrators
                  if you need further clarification.
                </p>
              `
              : ""
        }
        <p>The AdugboHub Team</p>
      </div>
    `;

    await this.sendEmailSafely(
      membership.user.email,
      "Membership update",
      html,
    );

    return updated;
  }

  /**
   * Emails every approved member who has an address.
   *
   * The campaign row is created first, so its id can be used
   * as the mail service's idempotency key.
   */
  async broadcastEmail(
    user: AuthUser,
    orgId: string,
    dto: BroadcastEmailDto,
  ) {
    await this.permissions.assert(user, orgId, "email.broadcast");

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

    const recipients = [
      ...new Set(
        members
          .map((membership) =>
            membership.user.email?.trim().toLowerCase(),
          )
          .filter((email): email is string => !!email),
      ),
    ];

    if (recipients.length === 0) {
      throw new BadRequestException(
        "No approved members have an email address to send to.",
      );
    }

    const campaign = await this.prisma.emailCampaign.create({
      data: {
        organizationId: orgId,
        senderId: user.id,
        subject: dto.subject,
        body: dto.body,
        recipientCount: recipients.length,
        status: EmailCampaignStatus.SENDING,
      },
    });

    const safeName = escapeHtml(organization.name);
    const safeBody = escapeHtml(dto.body).replace(
      /\r?\n/g,
      "<br/>",
    );

    const html = `
      <div>
        <h3>${safeName}</h3>
        <div>${safeBody}</div>
      </div>
    `;

    let accepted = 0;

    try {
      accepted = await this.mail.sendBulk(
        recipients,
        `[${organization.name}] ${dto.subject}`,
        html,
        campaign.id,
      );
    } catch {
      accepted = 0;
    }

    const failed = recipients.length - accepted;

    const status =
      accepted === 0
        ? EmailCampaignStatus.FAILED
        : failed > 0
          ? EmailCampaignStatus.PARTIAL
          : EmailCampaignStatus.COMPLETED;

    await this.prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        acceptedCount: accepted,
        failedCount: failed,
        status,
        sentAt: new Date(),
      },
    });

    return {
      campaignId: campaign.id,
      recipients: recipients.length,
      accepted,
      failed,
      status,
      // Kept so existing clients that read "sent" keep working.
      sent: accepted,
    };
  }
}
