import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatPrivacy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Verdict = 'ALLOWED' | 'REQUEST' | 'DENIED';
const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  private findConvo(a: string, b: string) {
    const [userAId, userBId] = pair(a, b);
    return this.prisma.conversation.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
  }

  private async isAdminOfOrgWhereMember(adminId: string, userId: string) {
    const adminOrgs = await this.prisma.membership.findMany({
      where: { userId: adminId, role: 'ORG_ADMIN', status: 'APPROVED' }, select: { organizationId: true },
    });
    if (!adminOrgs.length) return false;
    const m = await this.prisma.membership.findFirst({
      where: { userId, status: 'APPROVED', organizationId: { in: adminOrgs.map((o) => o.organizationId) } },
    });
    return !!m;
  }

  private async shareOrg(a: string, b: string) {
    const orgs = await this.prisma.membership.findMany({
      where: { userId: a, status: 'APPROVED' }, select: { organizationId: true },
    });
    if (!orgs.length) return false;
    const m = await this.prisma.membership.findFirst({
      where: { userId: b, status: 'APPROVED', organizationId: { in: orgs.map((o) => o.organizationId) } },
    });
    return !!m;
  }

  /** The privacy rules: can `senderId` start a conversation with `recipientId`? */
  async canStart(senderId: string, recipientId: string): Promise<Verdict> {
    const blocked = await this.prisma.block.findFirst({
      where: { OR: [{ blockerId: recipientId, blockedId: senderId }, { blockerId: senderId, blockedId: recipientId }] },
    });
    if (blocked) return 'DENIED';

    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient || !recipient.isActive) throw new NotFoundException('User not found');

    // Estate/org admins can always reach their members, and members can always reach their admins
    if (await this.isAdminOfOrgWhereMember(senderId, recipientId)) return 'ALLOWED';
    if (await this.isAdminOfOrgWhereMember(recipientId, senderId)) return 'ALLOWED';

    switch (recipient.chatPrivacy as ChatPrivacy) {
      case 'EVERYONE': return 'ALLOWED';
      case 'MY_ORGS_ONLY': return (await this.shareOrg(senderId, recipientId)) ? 'ALLOWED' : 'DENIED';
      case 'REQUEST_ONLY': return 'REQUEST';
      case 'ADMINS_ONLY': return 'DENIED';
    }
  }

  async send(senderId: string, recipientId: string, text: string) {
    if (senderId === recipientId) throw new BadRequestException('You cannot message yourself');
    let convo = await this.findConvo(senderId, recipientId);

    if (!convo) {
      const verdict = await this.canStart(senderId, recipientId);
      if (verdict === 'DENIED') throw new ForbiddenException('This user is not accepting messages from you');
      const [userAId, userBId] = pair(senderId, recipientId);
      convo = await this.prisma.conversation.create({
        data: { userAId, userBId, initiatorId: senderId, status: verdict === 'REQUEST' ? 'REQUESTED' : 'ACTIVE' },
      });
    } else {
      const blocked = await this.prisma.block.findFirst({
        where: { OR: [{ blockerId: recipientId, blockedId: senderId }, { blockerId: senderId, blockedId: recipientId }] },
      });
      if (blocked) throw new ForbiddenException('Messaging is blocked');

      if (convo.status === 'DECLINED' && convo.initiatorId === senderId) {
        throw new ForbiddenException('This user declined your message request');
      }
      if (convo.status === 'REQUESTED') {
        if (convo.initiatorId === senderId) {
          throw new ForbiddenException('Wait for the user to accept your message request');
        }
        // the recipient replying implicitly accepts
        convo = await this.prisma.conversation.update({ where: { id: convo.id }, data: { status: 'ACTIVE' } });
      } else if (convo.status === 'DECLINED') {
        // the decliner chose to message after all
        convo = await this.prisma.conversation.update({ where: { id: convo.id }, data: { status: 'ACTIVE' } });
      }
    }

    const message = await this.prisma.message.create({
      data: { conversationId: convo.id, senderId, body: text },
    });
    await this.prisma.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });
    return { message, conversation: convo };
  }

  async respondToRequest(userId: string, conversationId: string, accept: boolean) {
    const convo = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!convo || ![convo.userAId, convo.userBId].includes(userId)) throw new NotFoundException('Conversation not found');
    if (convo.status !== 'REQUESTED' || convo.initiatorId === userId) throw new BadRequestException('No pending request to answer');
    return this.prisma.conversation.update({
      where: { id: convo.id }, data: { status: accept ? 'ACTIVE' : 'DECLINED' },
    });
  }

  async conversations(userId: string, requestsOnly = false) {
    const convos = await this.prisma.conversation.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        ...(requestsOnly
          ? { status: 'REQUESTED', NOT: { initiatorId: userId } }
          : { status: { in: ['ACTIVE', 'REQUESTED'] } }),
      },
      include: {
        userA: { select: { id: true, fullName: true, avatarUrl: true } },
        userB: { select: { id: true, fullName: true, avatarUrl: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return convos.map((c) => ({
      id: c.id, status: c.status, initiatorId: c.initiatorId,
      other: c.userAId === userId ? c.userB : c.userA,
      lastMessage: c.messages[0] ?? null,
    }));
  }

  async messages(userId: string, conversationId: string, before?: string) {
    const convo = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!convo || ![convo.userAId, convo.userBId].includes(userId)) throw new NotFoundException('Conversation not found');
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() },
    });
    return this.prisma.message.findMany({
      where: { conversationId, ...(before && { createdAt: { lt: new Date(before) } }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  setPrivacy(userId: string, chatPrivacy: ChatPrivacy) {
    return this.prisma.user.update({ where: { id: userId }, data: { chatPrivacy }, select: { id: true, chatPrivacy: true } });
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException('Invalid');
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } }, create: { blockerId, blockedId }, update: {},
    });
    return { ok: true };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    return { ok: true };
  }
}
