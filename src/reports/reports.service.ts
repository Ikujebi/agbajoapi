
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Report, ReportStatus } from '@prisma/client';
import { ArtisansService } from '../artisan/artisans.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingsService } from '../marketplace/listings.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import {
  reportSubmittedTemplate,
  reportUpdateTemplate,
} from '../mail/templates';

import {
  CreateReportDto,
  ReportQueryDto,
  ReportTarget,
  ResolveAction,
  ResolveReportDto,
} from './dto/report.dto';

const OPEN_STATES: ReportStatus[] = ['OPEN', 'REVIEWING'];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORTS_PER_DAY = 10;

/** When this many different people report the same thing, admins are alerted. */
const ESCALATE_AT = 3;

const PERSON_SELECT = {
  id: true,
  firstName: true,
  otherNames: true,
  lastName: true,
} as const;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly listings: ListingsService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
    private readonly config: ConfigService,
    private readonly artisans: ArtisansService,
  ) {}

  // ---------- email helpers ----------

  private formatPersonName(person: {
    firstName?: string | null;
    otherNames?: string | null;
    lastName?: string | null;
  }): string {
    return [
      person.firstName,
      person.otherNames,
      person.lastName,
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || 'AdugboHub user';
  }

  private getReportUrl(reportId: string): string | undefined {
    const appUrl = this.config.get<string>('APP_URL')?.trim();

    if (!appUrl) {
      return undefined;
    }

    try {
      const baseUrl = new URL(appUrl);

      if (baseUrl.protocol !== 'https:') {
        return undefined;
      }

      return new URL(
        `/admin/reports/${encodeURIComponent(reportId)}`,
        baseUrl,
      ).toString();
    } catch {
      this.logger.warn(
        'APP_URL is invalid. Report emails will not include a review link.',
      );

      return undefined;
    }
  }

  private async sendEmailSafely(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    try {
      const sent = await this.mail.send(to, subject, html);

      if (!sent) {
        this.logger.warn(
          `Report email was not accepted for ${to}`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown email error';

      this.logger.error(
        `Report email failed for ${to}: ${message}`,
      );
    }
  }

  /**
   * Notify active platform super-admins about a newly submitted report.
   */
  private async emailSuperAdmins(
    report: {
      id: string;
      targetType: string;
      targetId: string;
      reason: string;
      details?: string | null;
      createdAt: Date;
    },
    reporterName: string,
  ): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: {
          isSuperAdmin: true,
          isActive: true,
          email: { not: null },
        },
        select: {
          email: true,
          firstName: true,
        },
      });

      if (!admins.length) {
        return;
      }

      const reportUrl = this.getReportUrl(report.id);

      await Promise.all(
        admins.map(async (admin) => {
          const email = admin.email?.trim();

          if (
            !email ||
            email.toLowerCase().endsWith('@pay.neighborhood.app')
          ) {
            return;
          }

          const html = this.mailTemplates.render(
            reportSubmittedTemplate,
            {
              recipientName: admin.firstName || 'Administrator',
              reporterName,
              reportId: report.id,
              targetType: report.targetType,
              targetId: report.targetId,
              reason: report.reason,
              details: report.details ?? undefined,
              submittedAt: report.createdAt,
              reportUrl,
            },
          );

          await this.sendEmailSafely(
            email,
            `New AdugboHub report: ${report.targetType}`,
            html,
          );
        }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error';

      this.logger.error(
        `Could not prepare report notification emails: ${message}`,
      );
    }
  }

  /**
   * Notify every distinct reporter when reports on a target are resolved.
   */
  private async emailReportersOfResolution(
    report: Report,
    reporterIds: string[],
    outcome: 'ACTIONED' | 'DISMISSED',
    resolutionNote?: string,
  ): Promise<void> {
    try {
      const uniqueReporterIds = [...new Set(reporterIds)];

      if (!uniqueReporterIds.length) {
        return;
      }

      const reporters = await this.prisma.user.findMany({
        where: {
          id: { in: uniqueReporterIds },
          isActive: true,
          email: { not: null },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
        },
      });

      const reportUrl = this.getReportUrl(report.id);

      await Promise.all(
        reporters.map(async (reporter) => {
          const email = reporter.email?.trim();

          if (
            !email ||
            email.toLowerCase().endsWith('@pay.neighborhood.app')
          ) {
            return;
          }

          const html = this.mailTemplates.render(
            reportUpdateTemplate,
            {
              recipientName: reporter.firstName || undefined,
              reportId: report.id,
              targetType: report.targetType,
              targetId: report.targetId,
              outcome,
              resolutionNote,
              resolvedAt: new Date(),
              reportUrl,
            },
          );

          await this.sendEmailSafely(
            email,
            outcome === 'ACTIONED'
              ? 'Update: Action has been taken on your AdugboHub report'
              : 'Update on your AdugboHub report',
            html,
          );
        }),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error';

      this.logger.error(
        `Could not prepare report resolution emails: ${message}`,
      );
    }
  }

  // ---------- helpers ----------

  /**
   * Checks the thing being reported exists and that the reporter may report
   * it. Returns the organization it belongs to, if any.
   */
  private async checkTarget(
    user: AuthUser,
    type: ReportTarget,
    id: string,
  ): Promise<string | null> {
    switch (type) {
      case 'LISTING': {
        const listing = await this.prisma.marketplaceListing.findUnique({
          where: { id },
          select: { sellerId: true },
        });

        if (!listing) {
          throw new NotFoundException(
            'That listing no longer exists.',
          );
        }

        if (listing.sellerId === user.id) {
          throw new BadRequestException(
            'You cannot report your own listing.',
          );
        }

        return null;
      }

      case 'USER': {
        const target = await this.prisma.user.findFirst({
          where: { id, isActive: true },
          select: { id: true },
        });

        if (!target) {
          throw new NotFoundException('User not found.');
        }

        if (id === user.id) {
          throw new BadRequestException(
            'You cannot report yourself.',
          );
        }

        return null;
      }

      case 'MESSAGE': {
        const message = await this.prisma.message.findUnique({
          where: { id },
          select: {
            senderId: true,
            conversation: {
              select: {
                userAId: true,
                userBId: true,
              },
            },
          },
        });

        // Only people in the conversation can report its messages.
        const participant =
          message &&
          [
            message.conversation.userAId,
            message.conversation.userBId,
          ].includes(user.id);

        if (!message || !participant) {
          throw new NotFoundException('Message not found.');
        }

        if (message.senderId === user.id) {
          throw new BadRequestException(
            'You cannot report your own message.',
          );
        }

        return null;
      }

      case 'ORGANIZATION': {
        const org = await this.prisma.organization.findUnique({
          where: { id },
          select: { id: true },
        });

        if (!org) {
          throw new NotFoundException('Organization not found.');
        }

        return org.id;
      }

      case 'NOTICE': {
        const notice = await this.prisma.notice.findUnique({
          where: { id },
          select: {
            organizationId: true,
            authorId: true,
          },
        });

        const member =
          notice &&
          (await this.prisma.membership.findUnique({
            where: {
              userId_organizationId: {
                userId: user.id,
                organizationId: notice.organizationId,
              },
            },
            select: { status: true },
          }));

        if (!notice || member?.status !== 'APPROVED') {
          throw new NotFoundException('Notice not found.');
        }

        if (notice.authorId === user.id) {
          throw new BadRequestException(
            'You cannot report your own notice.',
          );
        }

        return notice.organizationId;
      }

      case 'REVIEW': {
        const review = await this.prisma.review.findUnique({
          where: { id },
          select: {
            authorId: true,
            organizationId: true,
          },
        });

        if (!review) {
          throw new NotFoundException('Review not found.');
        }

        if (review.authorId === user.id) {
          throw new BadRequestException(
            'You cannot report your own review.',
          );
        }

        return review.organizationId;
      }
    }
  }

  /** The person responsible for the reported thing, if there is one. */
  private async offenderOf(
    type: string,
    id: string,
  ): Promise<string | null> {
    switch (type) {
      case 'LISTING':
        return (
          (
            await this.prisma.marketplaceListing.findUnique({
              where: { id },
              select: { sellerId: true },
            })
          )?.sellerId ?? null
        );

      case 'USER':
        return id;

      case 'MESSAGE':
        return (
          (
            await this.prisma.message.findUnique({
              where: { id },
              select: { senderId: true },
            })
          )?.senderId ?? null
        );

      case 'NOTICE':
        return (
          (
            await this.prisma.notice.findUnique({
              where: { id },
              select: { authorId: true },
            })
          )?.authorId ?? null
        );

      case 'REVIEW':
        return (
          (
            await this.prisma.review.findUnique({
              where: { id },
              select: { authorId: true },
            })
          )?.authorId ?? null
        );

      default:
        return null;
    }
  }

  /** What a moderator needs to see to judge the report. */
  private async preview(type: string, id: string) {
    switch (type) {
      case 'LISTING':
        return this.prisma.marketplaceListing.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            description: true,
            price: true,
            status: true,
            sellerId: true,
          },
        });

      case 'USER':
        return this.prisma.user.findUnique({
          where: { id },
          select: {
            ...PERSON_SELECT,
            phone: true,
            isActive: true,
          },
        });

      case 'MESSAGE':
        return this.prisma.message.findUnique({
          where: { id },
          select: {
            id: true,
            body: true,
            type: true,
            mediaUrl: true,
            deletedAt: true,
            senderId: true,
            createdAt: true,
          },
        });

      case 'ORGANIZATION':
        return this.prisma.organization.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            type: true,
            isActive: true,
          },
        });

      case 'NOTICE':
        return this.prisma.notice.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            body: true,
            status: true,
          },
        });

      case 'REVIEW':
        return this.prisma.review.findUnique({
          where: { id },
          select: {
            id: true,
            rating: true,
            comment: true,
            status: true,
          },
        });

      default:
        return null;
    }
  }

  // ---------- members ----------

  async create(user: AuthUser, dto: CreateReportDto) {
    const recent = await this.prisma.report.count({
      where: {
        reporterId: user.id,
        createdAt: {
          gt: new Date(Date.now() - DAY_MS),
        },
      },
    });

    if (recent >= MAX_REPORTS_PER_DAY) {
      throw new HttpException(
        'You have sent many reports today. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const organizationId = await this.checkTarget(
      user,
      dto.targetType,
      dto.targetId,
    );

    const existing = await this.prisma.report.findFirst({
      where: {
        reporterId: user.id,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: { in: OPEN_STATES },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'You have already reported this.',
      );
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId: user.id,
        organizationId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        details: dto.details?.trim(),
      },
    });

    // Find the reporter's display name for the administrator email.
    const reporter = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: PERSON_SELECT,
    });

    const reporterName = reporter
      ? this.formatPersonName(reporter)
      : 'AdugboHub user';

    // Count distinct reporters for this target.
    const reporters = await this.prisma.report.findMany({
      where: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: { in: OPEN_STATES },
      },
      distinct: ['reporterId'],
      select: { reporterId: true },
    });

    if (reporters.length === ESCALATE_AT) {
      await this.escalate(
        dto.targetType,
        dto.targetId,
        reporters.length,
      );
    }

    // Email active platform super-admins.
    await this.emailSuperAdmins(
      {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        details: report.details,
        createdAt: report.createdAt,
      },
      reporterName,
    );

    return {
      id: report.id,
      status: report.status,
    };
  }

  mine(user: AuthUser) {
    return this.prisma.report.findMany({
      where: { reporterId: user.id },
      select: {
        id: true,
        targetType: true,
        reason: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async escalate(
    type: string,
    id: string,
    count: number,
  ) {
    try {
      const admins = await this.prisma.user.findMany({
        where: {
          isSuperAdmin: true,
          isActive: true,
        },
        select: { id: true },
      });

      if (!admins.length) {
        return;
      }

      await this.notifications.send(
        admins.map((admin) => admin.id),
        {
          type: 'SYSTEM',
          title: 'Repeated reports',
          body: `A ${type.toLowerCase()} has been reported by ${count} different people.`,
          data: {
            targetType: type,
            targetId: id,
          },
        },
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown notification error';

      this.logger.error(
        `Could not send repeated-report notification: ${message}`,
      );
    }
  }

  // ---------- platform admins ----------

  async list(query: ReportQueryDto) {
    const limit = query.limit ?? 20;

    const direction: Prisma.SortOrder =
      query.status === 'OPEN' ? 'asc' : 'desc';

    const rows = await this.prisma.report.findMany({
      where: {
        ...(query.status
          ? { status: query.status }
          : {}),
        ...(query.targetType
          ? { targetType: query.targetType }
          : {}),
      },
      include: {
        reporter: { select: PERSON_SELECT },
        assignee: { select: PERSON_SELECT },
      },
      // The open queue is worked oldest-first so nothing waits forever.
      orderBy: [
        { createdAt: direction },
        { id: 'asc' },
      ],
      take: limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // How many open reports each target has in total.
    const counts = await this.prisma.report.groupBy({
      by: ['targetType', 'targetId'],
      where: {
        targetId: {
          in: items.map((item) => item.targetId),
        },
        status: { in: OPEN_STATES },
      },
      _count: true,
    });

    const countOf = new Map(
      counts.map((row) => [
        `${row.targetType}:${row.targetId}`,
        row._count,
      ]),
    );

    return {
      items: items.map((item) => ({
        ...item,
        openReportsOnTarget:
          countOf.get(
            `${item.targetType}:${item.targetId}`,
          ) ?? 0,
      })),
      nextCursor: hasMore
        ? items[items.length - 1].id
        : null,
    };
  }

  async get(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        reporter: { select: PERSON_SELECT },
        assignee: { select: PERSON_SELECT },
      },
    });

    if (!report) {
      throw new NotFoundException('Report not found.');
    }

    return {
      ...report,
      target: await this.preview(
        report.targetType,
        report.targetId,
      ),
    };
  }

  /** Takes a report so two moderators do not work on the same one. */
  async claim(admin: AuthUser, id: string) {
    const claimed = await this.prisma.report.updateMany({
      where: {
        id,
        status: { in: OPEN_STATES },
      },
      data: {
        assigneeId: admin.id,
        status: 'REVIEWING',
      },
    });

    if (claimed.count === 0) {
      throw new ConflictException(
        'This report is closed or does not exist.',
      );
    }

    return this.get(id);
  }

  private async performAction(
    admin: AuthUser,
    report: Report,
    action: ResolveAction,
  ): Promise<void> {
    switch (action) {
      case 'REMOVE_LISTING': {
        if (report.targetType !== 'LISTING') {
          throw new BadRequestException(
            'That action only applies to listings.',
          );
        }

        await this.listings.remove(admin, report.targetId);
        return;
      }

      case 'HIDE_REVIEW': {
  if (report.targetType !== 'REVIEW') {
    throw new BadRequestException('That action only applies to reviews.');
  }

  // Hide and recalculate together, so the average never counts a hidden review.
  await this.prisma.$transaction(async (tx) => {
    const review = await tx.review.update({
      where: { id: report.targetId },
      data: { status: 'HIDDEN' },
      select: { targetUserId: true, serviceBookingId: true },
    });

    // Only reviews of completed artisan jobs affect an artisan's average.
    if (review.targetUserId && review.serviceBookingId) {
      await this.artisans.refreshRating(review.targetUserId, tx);
    }
  });

  return;
}

      case 'DEACTIVATE_USER': {
        const offenderId = await this.offenderOf(
          report.targetType,
          report.targetId,
        );

        if (!offenderId) {
          throw new BadRequestException(
            'This report has no user to deactivate.',
          );
        }

        if (offenderId === admin.id) {
          throw new BadRequestException(
            'You cannot deactivate yourself.',
          );
        }

        const offender = await this.prisma.user.findUnique({
          where: { id: offenderId },
          select: { isSuperAdmin: true },
        });

        if (!offender || offender.isSuperAdmin) {
          throw new BadRequestException(
            'That account cannot be deactivated here.',
          );
        }

        // Deactivation takes effect at once: the access check runs on every
        // request, and refresh tokens are removed so they cannot sign in again.
        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: offenderId },
            data: { isActive: false },
          }),
          this.prisma.refreshToken.deleteMany({
            where: { userId: offenderId },
          }),
        ]);

        return;
      }
    }
  }

  async resolve(
    admin: AuthUser,
    id: string,
    dto: ResolveReportDto,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException('Report not found.');
    }

    if (!OPEN_STATES.includes(report.status)) {
      throw new ConflictException(
        'This report is already closed.',
      );
    }

    if (dto.outcome === 'DISMISSED' && dto.action) {
      throw new BadRequestException(
        'A dismissed report cannot trigger an action.',
      );
    }

    const note = dto.note?.trim();

    if (
      dto.outcome === 'ACTIONED' &&
      (!note || note.length < 3)
    ) {
      throw new BadRequestException(
        'Add a note explaining the action taken.',
      );
    }

    if (dto.action) {
      await this.performAction(
        admin,
        report,
        dto.action,
      );
    }

    const now = new Date();
    const status: ReportStatus = dto.outcome;

    // Everyone who reported the same thing gets the same outcome.
    const closed = await this.prisma.$transaction(async (tx) => {
      const related = await tx.report.findMany({
        where: {
          targetType: report.targetType,
          targetId: report.targetId,
          status: { in: OPEN_STATES },
        },
        select: {
          id: true,
          reporterId: true,
        },
      });

      await tx.report.updateMany({
        where: {
          id: {
            in: related.map((row) => row.id),
          },
        },
        data: {
          status,
          resolutionNote: note,
          resolvedAt: now,
        },
      });

      await tx.report.update({
        where: { id },
        data: {
          assigneeId: report.assigneeId ?? admin.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          organizationId: report.organizationId,
          action: 'OTHER',
          entityType: 'Report',
          entityId: id,
          metadata: {
            outcome: dto.outcome,
            action: dto.action ?? null,
            targetType: report.targetType,
            targetId: report.targetId,
            reportsClosed: related.length,
          },
        },
      });

      return related;
    });

    // Preserve in-app notifications, but don't let notification
    // provider failures prevent the resolution response.
    try {
      const reporterIds = [
        ...new Set(closed.map((row) => row.reporterId)),
      ];

      if (reporterIds.length) {
        await this.notifications.send(
          reporterIds,
          {
            type: 'SYSTEM',
            title: 'Update on your report',
            body:
              dto.outcome === 'ACTIONED'
                ? 'Thank you for reporting this. We have taken action.'
                : 'We reviewed your report and did not find a violation.',
            data: { reportId: id },
          },
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown notification error';

      this.logger.error(
        `Report in-app notification failed for ${id}: ${message}`,
      );
    }

    // Email all distinct reporters affected by this resolution.
    await this.emailReportersOfResolution(
      report,
      closed.map((row) => row.reporterId),
      dto.outcome,
      note,
    );

    return {
      id,
      status,
      reportsClosed: closed.length,
    };
  }
}
