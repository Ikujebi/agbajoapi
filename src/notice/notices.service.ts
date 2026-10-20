import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NoticeStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateNoticeDto, UpdateNoticeDto } from './dto/notice.dto';

@Injectable()
export class NoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private parseExpiry(value?: string): Date | undefined {
    if (value === undefined) return undefined;

    const date = new Date(value);

    if (date <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future.');
    }

    return date;
  }

  /** Tell every approved member (except the author) about a new notice. */
  private async notifyMembers(
    organizationId: string,
    authorId: string,
    noticeId: string,
    title: string,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const members = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        userId: { not: authorId },
      },
      select: { userId: true },
    });

    if (members.length === 0) return;

    await this.prisma.notification.createMany({
      data: members.map((member) => ({
        userId: member.userId,
        type: 'GENERAL' as const,
        title: `${organization?.name ?? 'Notice'}: ${title}`,
        body: 'A new notice has been posted.',
        data: { noticeId, organizationId },
      })),
    });
  }

  async create(user: AuthUser, organizationId: string, dto: CreateNoticeDto) {
    await this.permissions.assert(user, organizationId, 'notice.manage');

    const status = dto.status ?? NoticeStatus.PUBLISHED;

    if (status === NoticeStatus.ARCHIVED) {
      throw new BadRequestException('A new notice cannot start archived.');
    }

    const notice = await this.prisma.notice.create({
      data: {
        organizationId,
        authorId: user.id,
        title: dto.title.trim(),
        body: dto.body.trim(),
        status,
        publishedAt: status === NoticeStatus.PUBLISHED ? new Date() : null,
        expiresAt: this.parseExpiry(dto.expiresAt),
      },
    });

    if (status === NoticeStatus.PUBLISHED) {
      await this.notifyMembers(organizationId, user.id, notice.id, notice.title);
    }

    return notice;
  }

  /**
   * Members see published, unexpired notices.
   * People with notice.manage also see drafts and archived ones.
   */
  async list(user: AuthUser, organizationId: string, status?: NoticeStatus) {
    const canManage = await this.permissions.can(
      user,
      organizationId,
      'notice.manage',
    );

    if (!canManage) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: { userId: user.id, organizationId },
        },
        select: { status: true },
      });

      if (!user.isSuperAdmin && membership?.status !== 'APPROVED') {
        throw new ForbiddenException(
          'Only approved members can view notices.',
        );
      }
    }

    const now = new Date();

    return this.prisma.notice.findMany({
      where: canManage
        ? { organizationId, ...(status ? { status } : {}) }
        : {
            organizationId,
            status: NoticeStatus.PUBLISHED,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
      include: { author: { select: { id: true, fullName: true } } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateNoticeDto) {
    const notice = await this.prisma.notice.findUnique({ where: { id } });

    if (!notice) {
      throw new NotFoundException('Notice not found.');
    }

    await this.permissions.assert(user, notice.organizationId, 'notice.manage');

    const publishing =
      dto.status === NoticeStatus.PUBLISHED &&
      notice.status !== NoticeStatus.PUBLISHED;

    const updated = await this.prisma.notice.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.expiresAt !== undefined
          ? { expiresAt: this.parseExpiry(dto.expiresAt) }
          : {}),
        ...(publishing ? { publishedAt: new Date() } : {}),
      },
    });

    if (publishing) {
      await this.notifyMembers(
        updated.organizationId,
        user.id,
        updated.id,
        updated.title,
      );
    }

    return updated;
  }

  /** Notices are archived rather than deleted, so history is kept. */
  async archive(user: AuthUser, id: string) {
    const notice = await this.prisma.notice.findUnique({ where: { id } });

    if (!notice) {
      throw new NotFoundException('Notice not found.');
    }

    await this.permissions.assert(user, notice.organizationId, 'notice.manage');

    return this.prisma.notice.update({
      where: { id },
      data: { status: NoticeStatus.ARCHIVED },
    });
  }
}
