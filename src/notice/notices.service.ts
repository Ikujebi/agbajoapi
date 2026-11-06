
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NoticeStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateNoticeDto, UpdateNoticeDto } from './dto/notice.dto';
import { NotificationsService } from '../notifications/notifications.service';

import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { noticePublishedTemplate } from '../mail/templates';

@Injectable()
export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
  ) {}

  private parseExpiry(value?: string): Date | undefined {
    if (value === undefined) return undefined;

    const date = new Date(value);

    if (Number.isNaN(date.getTime()) || date <= new Date()) {
      throw new BadRequestException(
        'expiresAt must be a valid future date.',
      );
    }

    return date;
  }

  /**
   * Sends in-app, realtime and push notifications
   * to every approved member except the author.
   */
  private async notifyMembers(
    organizationId: string,
    authorId: string,
    noticeId: string,
    title: string,
  ): Promise<void> {
    try {
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

      await this.notifications.send(
        members.map((member) => member.userId),
        {
          title: `${organization?.name ?? 'Notice'}: ${title}`,
          body: 'A new notice has been posted.',
          data: { noticeId, organizationId },
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown notification error';

      this.logger.error(
        `Notice notification failed: ${message}`,
      );
    }
  }

  /**
   * Sends an email to all approved members except the author.
   * Email failures never undo notice creation or publication.
   */
  private async emailMembers(
    organizationId: string,
    authorId: string,
    noticeTitle: string,
    noticeBody: string,
  ): Promise<void> {
    try {
      const [organization, members] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        }),

        this.prisma.membership.findMany({
          where: {
            organizationId,
            status: 'APPROVED',
            userId: { not: authorId },
          },
          select: {
            user: {
              select: {
                email: true,
                firstName: true,
              },
            },
          },
        }),
      ]);

      const recipients = members.filter(
        (member) => member.user.email,
      );

      if (recipients.length === 0) return;

      const organizationName =
        organization?.name ?? 'Your community';

      const subject = `New notice: ${noticeTitle}`;

      // Send separately so one failed email doesn't stop other recipients.
      await Promise.all(
        recipients.map(async ({ user }) => {
          try {
            const html = this.mailTemplates.render(
              noticePublishedTemplate,
              {
                recipientName: user.firstName ?? undefined,
                organizationName,
                noticeTitle,
                noticeBody,
              },
            );

            await this.mail.send(
              user.email!,
              subject,
              html,
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Unknown email error';

            this.logger.error(
              `Failed to email a notice recipient: ${message}`,
            );
          }
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown email error';

      this.logger.error(
        `Could not prepare notice emails: ${message}`,
      );
    }
  }

  /**
   * Publishes a notice to the organization.
   */
  async create(
    user: AuthUser,
    organizationId: string,
    dto: CreateNoticeDto,
  ) {
    await this.permissions.assert(
      user,
      organizationId,
      'notice.manage',
    );

    const status = dto.status ?? NoticeStatus.PUBLISHED;

    if (status === NoticeStatus.ARCHIVED) {
      throw new BadRequestException(
        'A new notice cannot start archived.',
      );
    }

    const notice = await this.prisma.notice.create({
      data: {
        organizationId,
        authorId: user.id,
        title: dto.title.trim(),
        body: dto.body.trim(),
        status,
        publishedAt:
          status === NoticeStatus.PUBLISHED ? new Date() : null,
        expiresAt: this.parseExpiry(dto.expiresAt),
      },
    });

    if (status === NoticeStatus.PUBLISHED) {
      // In-app, realtime and push notifications.
      await this.notifyMembers(
        organizationId,
        user.id,
        notice.id,
        notice.title,
      );

      // Email notifications.
      await this.emailMembers(
        organizationId,
        user.id,
        notice.title,
        notice.body,
      );
    }

    return notice;
  }

  /**
   * Members see published, unexpired notices.
   * People with notice.manage also see drafts and archived ones.
   */
  async list(
    user: AuthUser,
    organizationId: string,
    status?: NoticeStatus,
  ) {
    const canManage = await this.permissions.can(
      user,
      organizationId,
      'notice.manage',
    );

    if (!canManage) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId,
          },
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
        ? {
            organizationId,
            ...(status ? { status } : {}),
          }
        : {
            organizationId,
            status: NoticeStatus.PUBLISHED,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
          },
        },
      },
      orderBy: [
        { publishedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 50,
    });
  }

  /**
   * Updates a notice.
   * Notifications are sent only when a notice becomes published.
   */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateNoticeDto,
  ) {
    const notice = await this.prisma.notice.findUnique({
      where: { id },
    });

    if (!notice) {
      throw new NotFoundException('Notice not found.');
    }

    await this.permissions.assert(
      user,
      notice.organizationId,
      'notice.manage',
    );

    const publishing =
      dto.status === NoticeStatus.PUBLISHED &&
      notice.status !== NoticeStatus.PUBLISHED;

    const updated = await this.prisma.notice.update({
      where: { id },
      data: {
        ...(dto.title !== undefined
          ? { title: dto.title.trim() }
          : {}),

        ...(dto.body !== undefined
          ? { body: dto.body.trim() }
          : {}),

        ...(dto.status !== undefined
          ? { status: dto.status }
          : {}),

        ...(dto.expiresAt !== undefined
          ? { expiresAt: this.parseExpiry(dto.expiresAt) }
          : {}),

        ...(publishing
          ? { publishedAt: new Date() }
          : {}),
      },
    });

    if (publishing) {
      // In-app, realtime and push notifications.
      await this.notifyMembers(
        updated.organizationId,
        user.id,
        updated.id,
        updated.title,
      );

      // Email notifications.
      await this.emailMembers(
        updated.organizationId,
        user.id,
        updated.title,
        updated.body,
      );
    }

    return updated;
  }

  /**
   * Notices are archived rather than deleted,
   * so community history is preserved.
   */
  async archive(user: AuthUser, id: string) {
    const notice = await this.prisma.notice.findUnique({
      where: { id },
    });

    if (!notice) {
      throw new NotFoundException('Notice not found.');
    }

    await this.permissions.assert(
      user,
      notice.organizationId,
      'notice.manage',
    );

    return this.prisma.notice.update({
      where: { id },
      data: {
        status: NoticeStatus.ARCHIVED,
      },
    });
  }
}
