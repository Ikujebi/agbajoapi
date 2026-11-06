import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { Permission } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { SmsService } from '../sms/sms.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

import {
  eventAnnouncementTemplate,
  eventCancellationTemplate,
  eventUpdatedTemplate,
} from '../mail/templates';

import {
  CreateEventDto,
  CreateEventInvitationDto,
  UpdateEventDto,
  VerifyEventInvitationDto,
  InvitationDeliveryDto,
} from './dto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeCode = (): string =>
  Array.from(
    { length: 8 },
    () => ALPHABET[randomInt(ALPHABET.length)],
  ).join('');

const hashCode = (code: string): string =>
  createHash('sha256')
    .update(code.trim().toUpperCase())
    .digest('hex');

type EventEmailDetails = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
    private readonly sms: SmsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async assertPermission(
    user: AuthUser,
    organizationId: string,
    permission: string,
  ) {
    await this.orgs.getOrThrow(organizationId);

    await this.permissions.assert(
      user,
      organizationId,
      permission as Permission,
    );
  }

  // ---------------------------------------------------------------------------
  // EMAIL HELPERS
  // ---------------------------------------------------------------------------

  private formatEventDate(date: Date): string {
    return date.toLocaleDateString('en-NG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Lagos',
    });
  }

  private formatEventTime(date: Date): string {
    return date.toLocaleTimeString('en-NG', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Lagos',
    });
  }

  private async getOrganizationName(
    organizationId: string,
  ): Promise<string> {
    const organization = await this.orgs.getOrThrow(organizationId);

    return organization.name;
  }

  /**
   * Gets email addresses belonging to approved organization members.
   */
  private async getApprovedMemberEmails(
    organizationId: string,
  ): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
      },
      select: {
        userId: true,
      },
      take: 5000,
    });

    const userIds = [
      ...new Set(memberships.map((membership) => membership.userId)),
    ];

    if (!userIds.length) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        email: true,
      },
    });

    return users
      .map((user) => user.email)
      .filter((email): email is string => Boolean(email?.trim()));
  }

  /**
   * Gets guest email addresses from invitations issued for an event.
   */
  private async getInvitedGuestEmails(eventId: string): Promise<string[]> {
    const invitations = await this.prisma.eventInvitation.findMany({
      where: {
        eventId,
        guestEmail: { not: null },
      },
      select: {
        guestEmail: true,
      },
      take: 5000,
    });

    return invitations
      .map((invitation) => invitation.guestEmail)
      .filter((email): email is string => Boolean(email?.trim()));
  }

  /**
   * Combines organization members and invited guests.
   */
  private async getEventEmailRecipients(
    event: Pick<EventEmailDetails, 'id' | 'organizationId'>,
  ): Promise<string[]> {
    const [memberEmails, guestEmails] = await Promise.all([
      this.getApprovedMemberEmails(event.organizationId),
      this.getInvitedGuestEmails(event.id),
    ]);

    return [
      ...new Set(
        [...memberEmails, ...guestEmails].map((email) =>
          email.trim().toLowerCase(),
        ),
      ),
    ];
  }

  /**
   * Sends an email to multiple recipients.
   * One failed email does not prevent delivery attempts to other recipients.
   */
  private async sendEventEmails(
    recipients: string[],
    subject: string,
    html: string,
  ): Promise<void> {
    const uniqueRecipients = [...new Set(recipients)];

    if (!uniqueRecipients.length) {
      return;
    }

    await Promise.all(
      uniqueRecipients.map(async (email) => {
        try {
          const sent = await this.mail.send(email, subject, html);

          if (!sent) {
            this.logger.warn(
              `Email provider did not accept event email for ${email}.`,
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown email delivery error';

          this.logger.error(
            `Failed to send event email to ${email}: ${message}`,
          );
        }
      }),
    );
  }

  /**
   * Sends an announcement when an event is published.
   */
  private async sendEventAnnouncement(
    event: EventEmailDetails,
  ): Promise<void> {
    try {
      const [organizationName, recipients] = await Promise.all([
        this.getOrganizationName(event.organizationId),
        this.getApprovedMemberEmails(event.organizationId),
      ]);

      if (!recipients.length) {
        return;
      }

      const html = this.mailTemplates.render(
        eventAnnouncementTemplate,
        {
          eventTitle: event.title,
          eventDescription: event.description ?? undefined,
          organizationName,
          startsAt: `${this.formatEventDate(event.startsAt)} at ${this.formatEventTime(event.startsAt)}`,
          endsAt: event.endsAt
            ? `${this.formatEventDate(event.endsAt)} at ${this.formatEventTime(event.endsAt)}`
            : undefined,
          location: event.location ?? undefined,
        },
      );

      await this.sendEventEmails(
        recipients,
        `New event announcement: ${event.title}`,
        html,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown announcement email error';

      this.logger.error(
        `Event announcement email failed for event ${event.id}: ${message}`,
      );
    }
  }

  /**
   * Sends an update notification when a published event changes.
   */
  private async sendEventUpdateEmails(
    event: EventEmailDetails,
    updateMessage: string,
  ): Promise<void> {
    try {
      const [organizationName, recipients] = await Promise.all([
        this.getOrganizationName(event.organizationId),
        this.getEventEmailRecipients(event),
      ]);

      if (!recipients.length) {
        return;
      }

      const html = this.mailTemplates.render(eventUpdatedTemplate, {
        eventName: event.title,
        communityName: organizationName,
        updateMessage,
        eventDate: this.formatEventDate(event.startsAt),
        eventTime: this.formatEventTime(event.startsAt),
        venue: event.location ?? undefined,
      });

      await this.sendEventEmails(
        recipients,
        `Event update: ${event.title}`,
        html,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown event update email error';

      this.logger.error(
        `Event update email failed for event ${event.id}: ${message}`,
      );
    }
  }

  /**
   * Sends cancellation notifications to members and invited guests.
   */
  private async sendEventCancellationEmails(
    event: EventEmailDetails,
  ): Promise<void> {
    try {
      const [organizationName, recipients] = await Promise.all([
        this.getOrganizationName(event.organizationId),
        this.getEventEmailRecipients(event),
      ]);

      if (!recipients.length) {
        return;
      }

      const html = this.mailTemplates.render(
        eventCancellationTemplate,
        {
          eventName: event.title,
          communityName: organizationName,
          eventDate: this.formatEventDate(event.startsAt),
          eventTime: this.formatEventTime(event.startsAt),
          venue: event.location ?? undefined,
          cancellationReason:
            'This event has been cancelled by the event organizers.',
          cancelledAt: new Date().toLocaleString('en-NG', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Africa/Lagos',
          }),
        },
      );

      await this.sendEventEmails(
        recipients,
        `Event cancelled: ${event.title}`,
        html,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown event cancellation email error';

      this.logger.error(
        `Event cancellation email failed for event ${event.id}: ${message}`,
      );
    }
  }

  private getEventUpdateMessage(
    oldEvent: EventEmailDetails,
    newEvent: EventEmailDetails,
  ): string | null {
    const changes: string[] = [];

    if (oldEvent.title !== newEvent.title) {
      changes.push('The event title has changed.');
    }

    if (oldEvent.description !== newEvent.description) {
      changes.push('The event description has been updated.');
    }

    if (oldEvent.location !== newEvent.location) {
      changes.push('The event venue or location has changed.');
    }

    if (
      oldEvent.startsAt.getTime() !== newEvent.startsAt.getTime()
    ) {
      changes.push('The event date or start time has changed.');
    }

    if (
      oldEvent.endsAt?.getTime() !== newEvent.endsAt?.getTime()
    ) {
      changes.push('The event end date or time has changed.');
    }

    return changes.length ? changes.join(' ') : null;
  }

  // ---------------------------------------------------------------------------
  // EVENT MANAGEMENT
  // ---------------------------------------------------------------------------

  async create(user: AuthUser, dto: CreateEventDto) {
    await this.assertPermission(
      user,
      dto.organizationId,
      'event.create',
    );

    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;

    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException(
        'startsAt must be a valid date.',
      );
    }

    if (
      endsAt &&
      (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)
    ) {
      throw new BadRequestException(
        'endsAt must be a valid date after startsAt.',
      );
    }

    if (
      dto.capacity !== undefined &&
      (!Number.isInteger(dto.capacity) || dto.capacity < 1)
    ) {
      throw new BadRequestException(
        'capacity must be a positive integer.',
      );
    }

    const event = await this.prisma.event.create({
      data: {
        organizationId: dto.organizationId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        location: dto.location?.trim(),
        startsAt,
        endsAt,
        capacity: dto.capacity,
        status: dto.status ?? 'DRAFT',
      },
    });

    // Announce immediately published events.
    if (event.status === 'PUBLISHED') {
      await this.sendEventAnnouncement(event);
    }

    return event;
  }

  async mine(user: AuthUser, organizationId?: string) {
    if (!organizationId) {
      const memberships = await this.prisma.membership.findMany({
        where: { userId: user.id },
        select: { organizationId: true },
        take: 500,
      });

      const ids = [
        ...new Set(memberships.map((membership) => membership.organizationId)),
      ];

      if (!ids.length) {
        return [];
      }

      return this.prisma.event.findMany({
        where: { organizationId: { in: ids } },
        orderBy: { startsAt: 'desc' },
        take: 100,
      });
    }

    await this.assertPermission(
      user,
      organizationId,
      'event.view',
    );

    return this.prisma.event.findMany({
      where: { organizationId },
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
  }

  async getOne(user: AuthUser, id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new NotFoundException('Event not found.');
    }

    await this.assertPermission(
      user,
      event.organizationId,
      'event.view',
    );

    return event;
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateEventDto,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      throw new NotFoundException('Event not found.');
    }

    await this.assertPermission(
      user,
      event.organizationId,
      'event.manage',
    );

    const startsAt = dto.startsAt
      ? new Date(dto.startsAt)
      : event.startsAt;

    const endsAt =
      dto.endsAt !== undefined
        ? dto.endsAt === null
          ? null
          : new Date(dto.endsAt)
        : event.endsAt;

    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException(
        'startsAt must be a valid date.',
      );
    }

    if (
      endsAt &&
      (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)
    ) {
      throw new BadRequestException(
        'endsAt must be after startsAt.',
      );
    }

    if (
      dto.capacity !== undefined &&
      dto.capacity !== null &&
      (!Number.isInteger(dto.capacity) || dto.capacity < 1)
    ) {
      throw new BadRequestException(
        'capacity must be a positive integer.',
      );
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description:
          dto.description === null
            ? null
            : dto.description?.trim(),
        location:
          dto.location === null
            ? null
            : dto.location?.trim(),
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt !== undefined ? endsAt : undefined,
        capacity: dto.capacity,
        status: dto.status,
      },
    });

    // Send a cancellation email only when a previously published
    // event changes to CANCELLED.
    if (
      event.status === 'PUBLISHED' &&
      updated.status === 'CANCELLED'
    ) {
      await this.sendEventCancellationEmails(updated);

      return updated;
    }

    // Announce an event when it moves from DRAFT to PUBLISHED.
    if (
      event.status !== 'PUBLISHED' &&
      updated.status === 'PUBLISHED'
    ) {
      await this.sendEventAnnouncement(updated);

      return updated;
    }

    // Send update emails when important details change on a published event.
    if (
      event.status === 'PUBLISHED' &&
      updated.status === 'PUBLISHED'
    ) {
      const updateMessage = this.getEventUpdateMessage(
        event,
        updated,
      );

      if (updateMessage) {
        await this.sendEventUpdateEmails(
          updated,
          updateMessage,
        );
      }
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // EVENT INVITATIONS
  // ---------------------------------------------------------------------------

  private invitationMessage(
    event: {
      title: string;
      startsAt: Date;
      location: string | null;
    },
    guestName: string,
    code: string,
    validUntil: Date,
  ) {
    const date = event.startsAt.toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    });

    return [
      `Hello ${guestName},`,
      `You are invited to ${event.title}.`,
      `Date: ${date}`,
      event.location ? `Location: ${event.location}` : undefined,
      `Your entry code: ${code}`,
      `Please present this code to protocol staff at the entrance.`,
      `Code valid until: ${validUntil.toLocaleString('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      })}.`,
      `Please keep this code private; it is intended for your entry.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  async createInvitation(
    user: AuthUser,
    eventId: string,
    dto: CreateEventInvitationDto,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found.');
    }

    await this.assertPermission(
      user,
      event.organizationId,
      'event.invite',
    );

    if (event.status !== 'PUBLISHED') {
      throw new BadRequestException(
        'Publish the event before issuing invitations.',
      );
    }

    if (event.endsAt && event.endsAt < new Date()) {
      throw new BadRequestException('This event has ended.');
    }

    const validFrom = dto.validFrom
      ? new Date(dto.validFrom)
      : event.startsAt;

    const validUntil = dto.validUntil
      ? new Date(dto.validUntil)
      : (event.endsAt ??
        new Date(event.startsAt.getTime() + 86400000));

    if (
      Number.isNaN(validFrom.getTime()) ||
      Number.isNaN(validUntil.getTime()) ||
      validUntil <= validFrom
    ) {
      throw new BadRequestException(
        'Invitation validity dates are invalid.',
      );
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();

      try {
        const invitation =
          await this.prisma.eventInvitation.create({
            data: {
              eventId,
              organizationId: event.organizationId,
              createdById: user.id,
              codeHash: hashCode(code),
              guestName: dto.guestName.trim(),
              guestEmail: dto.guestEmail
                ?.trim()
                .toLowerCase(),
              guestPhone: dto.guestPhone?.trim(),
              validFrom,
              validUntil,
            },
            omit: { codeHash: true },
          });

        const message = this.invitationMessage(
          event,
          invitation.guestName,
          code,
          validUntil,
        );

        return {
          ...invitation,
          code,
          shareMessage: message,
          delivery: 'NOT_SENT',
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException(
      'Could not generate a unique invitation code. Try again.',
    );
  }

  async sendInvitation(
    user: AuthUser,
    eventId: string,
    invitationId: string,
    dto: InvitationDeliveryDto,
  ) {
    const invitation =
      await this.prisma.eventInvitation.findFirst({
        where: { id: invitationId, eventId },
        include: { event: true },
      });

    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }

    await this.assertPermission(
      user,
      invitation.organizationId,
      'event.invite',
    );

    // The plaintext code is deliberately not stored, so it cannot be resent later.
    if (
      !dto.code ||
      hashCode(dto.code) !== invitation.codeHash
    ) {
      throw new BadRequestException(
        'The original invitation code is required. It is only returned when the invitation is created.',
      );
    }

    const message = this.invitationMessage(
      invitation.event,
      invitation.guestName,
      dto.code,
      invitation.validUntil,
    );

    if (
      dto.method === 'COPY' ||
      dto.method === 'MESSAGE'
    ) {
      return {
        method: dto.method,
        sent: false,
        shareMessage: message,
        code: dto.code,
      };
    }

    if (dto.method === 'EMAIL') {
      const to =
        dto.email?.trim().toLowerCase() ||
        invitation.guestEmail;

      if (!to) {
        throw new BadRequestException(
          'Provide an email address or save one on the invitation.',
        );
      }

      const html = `
        <p>Hello ${this.escapeHtml(invitation.guestName)},</p>
        <p>You are invited to <strong>${this.escapeHtml(invitation.event.title)}</strong>.</p>
        <p>${this.escapeHtml(message).replace(/\n/g, '<br>')}</p>
      `;

      const sent = await this.mail.send(
        to,
        `Your invitation: ${invitation.event.title}`,
        html,
      );

      if (!sent) {
        throw new BadRequestException(
          'Email could not be sent. Copy the message and send it manually.',
        );
      }

      return {
        method: 'EMAIL',
        sent: true,
        recipient: to,
        shareMessage: message,
      };
    }

    if (dto.method === 'SMS') {
      const to =
        dto.phone?.trim() || invitation.guestPhone;

      if (!to) {
        throw new BadRequestException(
          'Provide a phone number or save one on the invitation.',
        );
      }

      await this.sms.send(to, message);

      return {
        method: 'SMS',
        sent: true,
        recipient: to,
        shareMessage: message,
      };
    }
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]!);
  }

  async invitations(user: AuthUser, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found.');
    }

    await this.assertPermission(
      user,
      event.organizationId,
      'event.invite',
    );

    return this.prisma.eventInvitation.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      omit: { codeHash: true },
    });
  }

  // ---------------------------------------------------------------------------
  // EVENT IMAGE UPLOADS
  // ---------------------------------------------------------------------------

  async uploadImages(
    user: AuthUser,
    eventId: string,
    files: Express.Multer.File[],
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found.');
    }

    await this.assertPermission(
      user,
      event.organizationId,
      'event.manage',
    );

    if (files.length > 5) {
      throw new BadRequestException(
        'You can upload at most five images at a time.',
      );
    }

    const uploaded: Array<{
      url: string;
      publicId: string;
      width: number;
      height: number;
      format: string;
    }> = [];

    try {
      for (const file of files) {
        const image = await this.cloudinary.uploadImage(
          file,
          `events/${eventId}`,
        );

        uploaded.push(image);
      }

      return await this.prisma.$transaction(
        uploaded.map((image) =>
          this.prisma.eventMedia.create({
            data: {
              eventId,
              url: image.url,
              publicId: image.publicId,
              width: image.width,
              height: image.height,
              format: image.format,
            },
          }),
        ),
      );
    } catch (error) {
      // Best-effort cleanup if database persistence fails.
      await Promise.all(
        uploaded.map((image) =>
          this.cloudinary
            .deleteAsset(image.publicId)
            .catch(() => undefined),
        ),
      );

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // INVITATION VERIFICATION AND CHECK-IN
  // ---------------------------------------------------------------------------

  private async findValidInvitation(
    dto: VerifyEventInvitationDto,
  ) {
    const invitation =
      await this.prisma.eventInvitation.findFirst({
        where: {
          codeHash: hashCode(dto.code),
          eventId: dto.eventId,
        },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              organizationId: true,
              startsAt: true,
              endsAt: true,
              status: true,
            },
          },
        },
      });

    if (!invitation) {
      throw new NotFoundException('Invalid invitation code.');
    }

    const now = new Date();

    if (invitation.status === 'REVOKED') {
      throw new BadRequestException(
        'This invitation has been revoked.',
      );
    }

    if (invitation.status === 'CHECKED_IN') {
      throw new BadRequestException(
        'This invitation has already been checked in.',
      );
    }

    if (
      invitation.status === 'EXPIRED' ||
      now > invitation.validUntil
    ) {
      throw new BadRequestException(
        'This invitation has expired.',
      );
    }

    if (now < invitation.validFrom) {
      throw new BadRequestException(
        'This invitation is not valid yet.',
      );
    }

    if (invitation.event.status !== 'PUBLISHED') {
      throw new BadRequestException(
        'This event is not accepting guests.',
      );
    }

    return invitation;
  }

  async verifyInvitation(
    user: AuthUser,
    dto: VerifyEventInvitationDto,
  ) {
    const invitation = await this.findValidInvitation(dto);

    await this.assertPermission(
      user,
      invitation.organizationId,
      'event.checkin',
    );

    return {
      valid: true,
      guestName: invitation.guestName,
      guestEmail: invitation.guestEmail,
      guestPhone: invitation.guestPhone,
      event: invitation.event,
      invitationId: invitation.id,
      checkedIn: false,
    };
  }

  async checkIn(
    user: AuthUser,
    dto: VerifyEventInvitationDto,
  ) {
    const invitation = await this.findValidInvitation(dto);

    await this.assertPermission(
      user,
      invitation.organizationId,
      'event.checkin',
    );

    const now = new Date();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.eventInvitation.updateMany({
          where: {
            id: invitation.id,
            status: 'ACTIVE',
            checkedInAt: null,
            validFrom: { lte: now },
            validUntil: { gte: now },
          },
          data: {
            status: 'CHECKED_IN',
            checkedInAt: now,
            checkedInById: user.id,
          },
        });

        if (claimed.count !== 1) {
          throw new ConflictException(
            'This invitation has already been used or is no longer valid.',
          );
        }

        return tx.eventInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
          omit: { codeHash: true },
        });
      },
    );

    return {
      ok: true,
      guestName: result.guestName,
      eventId: result.eventId,
      checkedInAt: result.checkedInAt,
    };
  }
}