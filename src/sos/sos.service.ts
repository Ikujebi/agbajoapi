
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SosStatus } from '@prisma/client';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { rolesWith } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';

import {
  sosAlertTemplate,
  sosAcknowledgedTemplate,
  sosResolvedTemplate,
  sosCancelledTemplate,
} from '../mail/templates';

import { TriggerSosDto } from './dto/sos.dto';

/** A user who already has an open alert this recent gets that alert back. */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Safely sends an email.
   * Email failures must never undo an SOS operation.
   */
  private async sendEmailSafely(
    email: string | null | undefined,
    subject: string,
    html: string,
  ): Promise<void> {
    if (!email || email.endsWith('@pay.neighborhood.app')) {
      return;
    }

    try {
      const accepted = await this.mailService.send(
        email,
        subject,
        html,
      );

      if (!accepted) {
        this.logger.warn(
          `SOS email was not accepted by the mail provider: ${subject}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send SOS email: ${subject}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Sends in-app notifications and email notifications to approved
   * estate responders who have the sos.respond permission.
   */
  private async notifyResponders(
    organizationId: string,
    excludeUserId: string,
    title: string,
    body: string,
    data: Record<string, string | number | null>,
    emailEvent?: {
      type: 'ALERT' | 'CANCELLED';
      alertId: string;
      residentName: string;
      eventAt?: Date;
    },
  ): Promise<void> {
    try {
      const [organization, responders] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        }),

        this.prisma.membership.findMany({
          where: {
            organizationId,
            status: 'APPROVED',
            role: {
              in: rolesWith('ESTATE', 'sos.respond'),
            },
            userId: { not: excludeUserId },
          },
          select: {
            userId: true,
            user: {
              select: {
                firstName: true,
                email: true,
              },
            },
          },
        }),
      ]);

      if (responders.length === 0) return;

      // In-app notification.
      try {
        await this.notifications.send(
          responders.map((responder) => responder.userId),
          {
            type: 'SAFETY',
            title,
            body,
            data,
          },
        );
      } catch (error) {
        this.logger.error(
          'Failed to send SOS in-app notifications to responders.',
          error instanceof Error ? error.stack : String(error),
        );
      }

      if (!emailEvent || !organization) return;

      // Prevent sending multiple emails to the same address.
      const recipients = new Map<
        string,
        { email: string; firstName: string | undefined }
      >();

      for (const responder of responders) {
        const email = responder.user?.email?.trim().toLowerCase();

        if (!email || email.endsWith('@pay.neighborhood.app')) {
          continue;
        }

        if (!recipients.has(email)) {
          recipients.set(email, {
            email,
            firstName: responder.user?.firstName,
          });
        }
      }

      const emailJobs = Array.from(recipients.values()).map(
        async (recipient) => {
          const options = {
            recipientName: recipient.firstName,
            organizationName: organization.name,
            alertId: emailEvent.alertId,
            residentName: emailEvent.residentName,
            eventAt: emailEvent.eventAt,
          };

          if (emailEvent.type === 'ALERT') {
            await this.sendEmailSafely(
              recipient.email,
              'Emergency SOS Alert',
              sosAlertTemplate(options),
            );
          } else {
            await this.sendEmailSafely(
              recipient.email,
              'SOS Alert Cancelled',
              sosCancelledTemplate(options),
            );
          }
        },
      );

      await Promise.all(emailJobs);
    } catch (error) {
      this.logger.error(
        'Failed to notify estate SOS responders.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Safely notifies the resident who triggered an SOS alert.
   */
  private async notifyResident(
    userId: string,
    organizationId: string,
    alertId: string,
    event: 'ACKNOWLEDGED' | 'RESOLVED',
    eventAt: Date,
  ): Promise<void> {
    try {
      const [resident, organization] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            firstName: true,
            email: true,
          },
        }),

        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        }),
      ]);

      if (!resident?.email || !organization) return;

      const options = {
        recipientName: resident.firstName,
        organizationName: organization.name,
        alertId,
        eventAt,
      };

      if (event === 'ACKNOWLEDGED') {
        await this.sendEmailSafely(
          resident.email,
          'Your SOS Alert Has Been Acknowledged',
          sosAcknowledgedTemplate(options),
        );
      } else {
        await this.sendEmailSafely(
          resident.email,
          'Your SOS Alert Has Been Resolved',
          sosResolvedTemplate(options),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send SOS ${event.toLowerCase()} email to resident.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async trigger(
    user: AuthUser,
    organizationId: string,
    dto: TriggerSosDto,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        type: true,
        name: true,
        isActive: true,
      },
    });

    if (!organization || !organization.isActive) {
      throw new NotFoundException('Organization not found.');
    }

    if (organization.type !== 'ESTATE') {
      throw new BadRequestException(
        'SOS alerts are only available in estates.',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId,
        },
      },
      select: { status: true },
    });

    if (membership?.status !== 'APPROVED') {
      throw new ForbiddenException(
        'Only approved estate members can send SOS.',
      );
    }

    if (
      (dto.latitude === undefined) !==
      (dto.longitude === undefined)
    ) {
      throw new BadRequestException(
        'Send both latitude and longitude, or neither.',
      );
    }

    // Repeated taps return a recent open alert instead of creating duplicates.
    const recent = await this.prisma.sosAlert.findFirst({
      where: {
        organizationId,
        userId: user.id,
        status: {
          in: ['OPEN', 'ACKNOWLEDGED'],
        },
        createdAt: {
          gt: new Date(Date.now() - DUPLICATE_WINDOW_MS),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recent) return recent;

    const alert = await this.prisma.sosAlert.create({
      data: {
        organizationId,
        userId: user.id,
        message: dto.message?.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });

    const sender = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        firstName: true,
        otherNames: true,
        lastName: true,
        phone: true,
      },
    });

    const senderName = sender
      ? [
          sender.firstName,
          sender.otherNames,
          sender.lastName,
        ]
          .filter((name) => name?.trim())
          .join(' ')
      : '';

    await this.notifyResponders(
      organizationId,
      user.id,
      `SOS: ${senderName || 'A resident'} needs help`,
      dto.message?.trim() ||
        `Emergency alert in ${organization.name}.`,
      {
        alertId: alert.id,
        organizationId,
        phone: sender?.phone ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
      {
        type: 'ALERT',
        alertId: alert.id,
        residentName: senderName || 'A resident',
        eventAt: alert.createdAt,
      },
    );

    return alert;
  }

  async list(
    user: AuthUser,
    organizationId: string,
    status?: SosStatus,
  ) {
    await this.permissions.assert(
      user,
      organizationId,
      'sos.respond',
    );

    return this.prisma.sosAlert.findMany({
      where: {
        organizationId,
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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  mine(userId: string) {
    return this.prisma.sosAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async loadForResponder(
    user: AuthUser,
    id: string,
  ) {
    const alert = await this.prisma.sosAlert.findUnique({
      where: { id },
    });

    if (!alert) {
      throw new NotFoundException('SOS alert not found.');
    }

    await this.permissions.assert(
      user,
      alert.organizationId,
      'sos.respond',
    );

    return alert;
  }

  async acknowledge(user: AuthUser, id: string) {
    const alert = await this.loadForResponder(user, id);

    // Claim by status so two responders cannot both acknowledge the alert.
    const acknowledgedAt = new Date();

    const claimed = await this.prisma.sosAlert.updateMany({
      where: {
        id,
        status: 'OPEN',
      },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt,
      },
    });

    if (claimed.count === 0) {
      throw new ConflictException(
        'This alert has already been handled.',
      );
    }

    // In-app notification.
    try {
      await this.notifications.send([alert.userId], {
        type: 'SAFETY',
        title: 'Help is on the way',
        body: 'Your SOS has been acknowledged by estate security.',
        data: { alertId: id },
      });
    } catch (error) {
      this.logger.error(
        'Failed to send SOS acknowledgement notification.',
        error instanceof Error ? error.stack : String(error),
      );
    }

    // Email notification.
    await this.notifyResident(
      alert.userId,
      alert.organizationId,
      id,
      'ACKNOWLEDGED',
      acknowledgedAt,
    );

    return this.prisma.sosAlert.findUniqueOrThrow({
      where: { id },
    });
  }

  async resolve(user: AuthUser, id: string) {
    const alert = await this.loadForResponder(user, id);

    const resolvedAt = new Date();

    const claimed = await this.prisma.sosAlert.updateMany({
      where: {
        id,
        status: {
          in: ['OPEN', 'ACKNOWLEDGED'],
        },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt,
      },
    });

    if (claimed.count === 0) {
      throw new ConflictException(
        'This alert is already closed.',
      );
    }

    // In-app notification.
    try {
      await this.notifications.send([alert.userId], {
        type: 'SAFETY',
        title: 'SOS resolved',
        body: 'Your SOS alert was marked as resolved.',
        data: { alertId: id },
      });
    } catch (error) {
      this.logger.error(
        'Failed to send SOS resolution notification.',
        error instanceof Error ? error.stack : String(error),
      );
    }

    // Email notification.
    await this.notifyResident(
      alert.userId,
      alert.organizationId,
      id,
      'RESOLVED',
      resolvedAt,
    );

    return this.prisma.sosAlert.findUniqueOrThrow({
      where: { id },
    });
  }

  /**
   * The person who raised the alert can cancel it,
   * for example after a false alarm.
   */
  async cancel(userId: string, id: string) {
    const alert = await this.prisma.sosAlert.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!alert) {
      throw new NotFoundException('SOS alert not found.');
    }

    const cancelledAt = new Date();

    const claimed = await this.prisma.sosAlert.updateMany({
      where: {
        id,
        status: {
          in: ['OPEN', 'ACKNOWLEDGED'],
        },
      },
      data: {
        status: 'CANCELLED',
        resolvedAt: cancelledAt,
      },
    });

    if (claimed.count === 0) {
      throw new ConflictException(
        'This alert is already closed.',
      );
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        otherNames: true,
        lastName: true,
      },
    });

    const residentName = sender
      ? [
          sender.firstName,
          sender.otherNames,
          sender.lastName,
        ]
          .filter((name) => name?.trim())
          .join(' ')
      : 'A resident';

    await this.notifyResponders(
      alert.organizationId,
      userId,
      'SOS cancelled',
      'The resident cancelled their alert.',
      {
        alertId: id,
        organizationId: alert.organizationId,
      },
      {
        type: 'CANCELLED',
        alertId: id,
        residentName: residentName || 'A resident',
        eventAt: cancelledAt,
      },
    );

    return this.prisma.sosAlert.findUniqueOrThrow({
      where: { id },
    });
  }
}
