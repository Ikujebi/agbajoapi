import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { Permission } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms1/sms.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  CreateEventDto, CreateEventInvitationDto, UpdateEventDto,
  VerifyEventInvitationDto, InvitationDeliveryDto,
} from './dto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = (): string =>
  Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const hashCode = (code: string): string =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async assertPermission(user: AuthUser, organizationId: string, permission: string) {
    await this.orgs.getOrThrow(organizationId);
    await this.permissions.assert(user, organizationId, permission as Permission);
  }

  async create(user: AuthUser, dto: CreateEventDto) {
    await this.assertPermission(user, dto.organizationId, 'event.create');
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt must be a valid date.');
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) {
      throw new BadRequestException('endsAt must be a valid date after startsAt.');
    }
    if (dto.capacity !== undefined && (!Number.isInteger(dto.capacity) || dto.capacity < 1)) {
      throw new BadRequestException('capacity must be a positive integer.');
    }
    return this.prisma.event.create({
      data: {
        organizationId: dto.organizationId, title: dto.title.trim(),
        description: dto.description?.trim(), location: dto.location?.trim(),
        startsAt, endsAt, capacity: dto.capacity, status: dto.status ?? 'DRAFT',
      },
    });
  }

  async mine(user: AuthUser, organizationId?: string) {
    if (!organizationId) {
      const memberships = await this.prisma.membership.findMany({
        where: { userId: user.id }, select: { organizationId: true }, take: 500,
      });
      const ids = [...new Set(memberships.map((m) => m.organizationId))];
      if (!ids.length) return [];
      return this.prisma.event.findMany({
        where: { organizationId: { in: ids } }, orderBy: { startsAt: 'desc' }, take: 100,
      });
    }
    await this.assertPermission(user, organizationId, 'event.view');
    return this.prisma.event.findMany({
      where: { organizationId }, orderBy: { startsAt: 'desc' }, take: 100,
    });
  }

  async getOne(user: AuthUser, id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found.');
    await this.assertPermission(user, event.organizationId, 'event.view');
    return event;
  }

  async update(user: AuthUser, id: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found.');
    await this.assertPermission(user, event.organizationId, 'event.manage');
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
    const endsAt = dto.endsAt !== undefined ? (dto.endsAt === null ? null : new Date(dto.endsAt)) : event.endsAt;
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('startsAt must be a valid date.');
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) {
      throw new BadRequestException('endsAt must be after startsAt.');
    }
    if (dto.capacity !== undefined && dto.capacity !== null && (!Number.isInteger(dto.capacity) || dto.capacity < 1)) {
      throw new BadRequestException('capacity must be a positive integer.');
    }
    return this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === null ? null : dto.description?.trim(),
        location: dto.location === null ? null : dto.location?.trim(),
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt !== undefined ? endsAt : undefined,
        capacity: dto.capacity, status: dto.status,
      },
    });
  }

  private invitationMessage(event: { title: string; startsAt: Date; location: string | null }, guestName: string, code: string, validUntil: Date) {
    const date = event.startsAt.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
    return [
      `Hello ${guestName},`,
      `You are invited to ${event.title}.`,
      `Date: ${date}`,
      event.location ? `Location: ${event.location}` : undefined,
      `Your entry code: ${code}`,
      `Please present this code to protocol staff at the entrance.`,
      `Code valid until: ${validUntil.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })}.`,
      `Please keep this code private; it is intended for your entry.`,
    ].filter(Boolean).join('\n');
  }

  async createInvitation(user: AuthUser, eventId: string, dto: CreateEventInvitationDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found.');
    await this.assertPermission(user, event.organizationId, 'event.invite');
    if (event.status !== 'PUBLISHED') throw new BadRequestException('Publish the event before issuing invitations.');
    if (event.endsAt && event.endsAt < new Date()) throw new BadRequestException('This event has ended.');

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : event.startsAt;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : (event.endsAt ?? new Date(event.startsAt.getTime() + 86400000));
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validUntil <= validFrom) {
      throw new BadRequestException('Invitation validity dates are invalid.');
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        const invitation = await this.prisma.eventInvitation.create({
          data: {
            eventId, organizationId: event.organizationId, createdById: user.id,
            codeHash: hashCode(code), guestName: dto.guestName.trim(),
            guestEmail: dto.guestEmail?.trim().toLowerCase(), guestPhone: dto.guestPhone?.trim(),
            validFrom, validUntil,
          },
          omit: { codeHash: true },
        });
        const message = this.invitationMessage(event, invitation.guestName, code, validUntil);
        return { ...invitation, code, shareMessage: message, delivery: 'NOT_SENT' };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    throw new ConflictException('Could not generate a unique invitation code. Try again.');
  }

  async sendInvitation(user: AuthUser, eventId: string, invitationId: string, dto: InvitationDeliveryDto) {
    const invitation = await this.prisma.eventInvitation.findFirst({
      where: { id: invitationId, eventId },
      include: { event: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    await this.assertPermission(user, invitation.organizationId, 'event.invite');

    // The plaintext code is deliberately not stored, so it cannot be resent later.
    // This endpoint is for sharing a supplied code only if the caller has it.
    if (!dto.code || hashCode(dto.code) !== invitation.codeHash) {
      throw new BadRequestException('The original invitation code is required. It is only returned when the invitation is created.');
    }
    const message = this.invitationMessage(invitation.event, invitation.guestName, dto.code, invitation.validUntil);
    if (dto.method === 'COPY' || dto.method === 'MESSAGE') {
      return { method: dto.method, sent: false, shareMessage: message, code: dto.code };
    }
    if (dto.method === 'EMAIL') {
      const to = dto.email?.trim().toLowerCase() || invitation.guestEmail;
      if (!to) throw new BadRequestException('Provide an email address or save one on the invitation.');
      const html = `<p>Hello ${this.escapeHtml(invitation.guestName)},</p><p>You are invited to <strong>${this.escapeHtml(invitation.event.title)}</strong>.</p><p>${this.escapeHtml(message).replace(/\n/g, '<br>')}</p>`;
      const sent = await this.mail.send(to, `Your invitation: ${invitation.event.title}`, html);
      if (!sent) throw new BadRequestException('Email could not be sent. Copy the message and send it manually.');
      return { method: 'EMAIL', sent: true, recipient: to, shareMessage: message };
    }
    if (dto.method === 'SMS') {
      const to = dto.phone?.trim() || invitation.guestPhone;
      if (!to) throw new BadRequestException('Provide a phone number or save one on the invitation.');
      await this.sms.send(to, message);
      return { method: 'SMS', sent: true, recipient: to, shareMessage: message };
    }
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]!);
  }

  async invitations(user: AuthUser, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found.');
    await this.assertPermission(user, event.organizationId, 'event.invite');
    return this.prisma.eventInvitation.findMany({
      where: { eventId }, orderBy: { createdAt: 'desc' }, take: 500, omit: { codeHash: true },
    });
  }

  async uploadImages(user: AuthUser, eventId: string, files: Express.Multer.File[]) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found.');
    await this.assertPermission(user, event.organizationId, 'event.manage');
    if (files.length > 5) throw new BadRequestException('You can upload at most five images at a time.');

    const uploaded: Array<{ url: string; publicId: string; width: number; height: number; format: string }> = [];
    try {
      for (const file of files) {
        const image = await this.cloudinary.uploadImage(file, `events/${eventId}`);
        uploaded.push(image);
      }
      return await this.prisma.$transaction(
        uploaded.map((image) => this.prisma.eventMedia.create({
          data: { eventId, url: image.url, publicId: image.publicId, width: image.width, height: image.height, format: image.format },
        })),
      );
    } catch (error) {
      // Best-effort cleanup if database persistence fails.
      await Promise.all(uploaded.map((image) => this.cloudinary.deleteAsset(image.publicId).catch(() => undefined)));
      throw error;
    }
  }

  private async findValidInvitation(dto: VerifyEventInvitationDto) {
    const invitation = await this.prisma.eventInvitation.findFirst({
      where: { codeHash: hashCode(dto.code), eventId: dto.eventId },
      include: { event: { select: { id: true, title: true, organizationId: true, startsAt: true, endsAt: true, status: true } } },
    });
    if (!invitation) throw new NotFoundException('Invalid invitation code.');
    const now = new Date();
    if (invitation.status === 'REVOKED') throw new BadRequestException('This invitation has been revoked.');
    if (invitation.status === 'CHECKED_IN') throw new BadRequestException('This invitation has already been checked in.');
    if (invitation.status === 'EXPIRED' || now > invitation.validUntil) throw new BadRequestException('This invitation has expired.');
    if (now < invitation.validFrom) throw new BadRequestException('This invitation is not valid yet.');
    if (invitation.event.status !== 'PUBLISHED') throw new BadRequestException('This event is not accepting guests.');
    return invitation;
  }

  async verifyInvitation(user: AuthUser, dto: VerifyEventInvitationDto) {
    const invitation = await this.findValidInvitation(dto);
    await this.assertPermission(user, invitation.organizationId, 'event.checkin');
    return {
      valid: true, guestName: invitation.guestName, guestEmail: invitation.guestEmail,
      guestPhone: invitation.guestPhone, event: invitation.event,
      invitationId: invitation.id, checkedIn: false,
    };
  }

  async checkIn(user: AuthUser, dto: VerifyEventInvitationDto) {
    const invitation = await this.findValidInvitation(dto);
    await this.assertPermission(user, invitation.organizationId, 'event.checkin');
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.eventInvitation.updateMany({
        where: { id: invitation.id, status: 'ACTIVE', checkedInAt: null, validFrom: { lte: now }, validUntil: { gte: now } },
        data: { status: 'CHECKED_IN', checkedInAt: now, checkedInById: user.id },
      });
      if (claimed.count !== 1) throw new ConflictException('This invitation has already been used or is no longer valid.');
      return tx.eventInvitation.findUniqueOrThrow({ where: { id: invitation.id }, omit: { codeHash: true } });
    });
    return { ok: true, guestName: result.guestName, eventId: result.eventId, checkedInAt: result.checkedInAt };
  }
}
