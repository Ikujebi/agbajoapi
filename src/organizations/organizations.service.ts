import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipRole, OrgType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BroadcastEmailDto, CreateOrgDto, JoinOrgDto, ReviewMembershipDto } from './dto';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  /** Throws unless the user is an APPROVED member of the org with one of the roles. */
  async assertRole(userId: string, organizationId: string, roles: MembershipRole[]) {
    const m = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!m || m.status !== 'APPROVED' || !roles.includes(m.role)) {
      throw new ForbiddenException('You do not have permission for this organization');
    }
    return m;
  }

  async getOrThrow(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  create(userId: string, dto: CreateOrgDto) {
    return this.prisma.organization.create({
      data: { ...dto, memberships: { create: { userId, role: 'ORG_ADMIN', status: 'APPROVED' } } },
    });
  }

  search(type?: OrgType, q?: string) {
    return this.prisma.organization.findMany({
      where: { ...(type && { type }), ...(q && { name: { contains: q, mode: 'insensitive' } }) },
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  mine(userId: string) {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async join(userId: string, orgId: string, dto: JoinOrgDto) {
    const org = await this.getOrThrow(orgId);
    if (org.type === 'SHOP') throw new BadRequestException('Shops cannot be joined');
    const existing = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    if (existing) throw new ConflictException(`Membership already ${existing.status.toLowerCase()}`);
    const membership = await this.prisma.membership.create({
      data: {
        userId, organizationId: orgId, unit: dto.unit, status: 'PENDING',
        role: org.type === 'ESTATE' ? 'RESIDENT' : 'MEMBER',
      },
    });
    const admins = await this.prisma.membership.findMany({
      where: { organizationId: orgId, role: 'ORG_ADMIN', status: 'APPROVED' },
    });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.userId, title: 'New join request', body: `A new user wants to join ${org.name}.`,
      })),
    });
    return membership;
  }

  async listMembers(userId: string, orgId: string, status?: string) {
    await this.assertRole(userId, orgId, ['ORG_ADMIN']);
    return this.prisma.membership.findMany({
      where: { organizationId: orgId, ...(status && { status: status as any }) },
      include: { user: { select: { id: true, fullName: true, phone: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async review(adminId: string, orgId: string, membershipId: string, dto: ReviewMembershipDto) {
    await this.assertRole(adminId, orgId, ['ORG_ADMIN']);
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId },
      include: { user: true, organization: true },
    });
    if (!m) throw new NotFoundException('Membership not found');
    if (m.userId === adminId && dto.status !== 'APPROVED') throw new BadRequestException('You cannot demote yourself');
    const updated = await this.prisma.membership.update({
      where: { id: m.id },
      data: { status: dto.status, ...(dto.role && { role: dto.role }) },
    });
    const body = `Your membership of ${m.organization.name} is now ${dto.status.toLowerCase()}.`;
    await this.prisma.notification.create({ data: { userId: m.userId, title: 'Membership update', body } });
    if (m.user.email) void this.mail.send(m.user.email, 'Membership update', `<p>${body}</p>`);
    return updated;
  }

  async broadcastEmail(adminId: string, orgId: string, dto: BroadcastEmailDto) {
    await this.assertRole(adminId, orgId, ['ORG_ADMIN']);
    const org = await this.getOrThrow(orgId);
    const members = await this.prisma.membership.findMany({
      where: { organizationId: orgId, status: 'APPROVED', user: { email: { not: null } } },
      include: { user: { select: { email: true } } },
    });
    const emails = members.map((m) => m.user.email!);
    const html = `<h3>${org.name}</h3><div>${dto.body.replace(/\n/g, '<br/>')}</div>`;
    const sent = await this.mail.sendBulk(emails, `[${org.name}] ${dto.subject}`, html);
    await this.prisma.emailCampaign.create({
      data: { organizationId: orgId, senderId: adminId, subject: dto.subject, body: dto.body, recipientCount: sent },
    });
    return { recipients: emails.length, sent };
  }
}
