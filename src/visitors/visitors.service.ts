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
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomInt } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrgHoursService } from '../org-hours/org-hours.service';
import { SmsService } from '../sms/sms.service';
import { MailService } from '../mail/mail.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { Permission } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CreatePassDto, VerifyPassDto } from './dto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const hashCode = (code: string): string =>
  createHash('sha256').update(code).digest('hex');

const normalizeCode = (code: string): string => code.trim().toUpperCase();

/** A host may send at most this many pass SMS in any 24 hours. */
const MAX_PASS_SMS_PER_DAY = 20;
const MAX_PASS_EMAIL_PER_DAY = 30;
const SEND_TIMEOUT_MS = 8000;

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

/**
 * Turns what a host typed into E.164 (+2348031234567), or null if it is not
 * a usable number. Nigerian local formats (0803..., 803..., 234803...) work.
 */
const normalizePhone = (raw: string | null | undefined): string | null => {
  if (!raw) return null;

  let value = raw.trim().replace(/[\s\-().]/g, '');

  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  if (value.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
  }

  if (!/^\d+$/.test(value)) return null;
  if (/^0[789]\d{9}$/.test(value)) return `+234${value.slice(1)}`;
  if (/^234[789]\d{9}$/.test(value)) return `+${value}`;
  if (/^[789]\d{9}$/.test(value)) return `+234${value}`;

  return null;
};

/**
 * Keeps the SMS in the cheap 160-character alphabet. One accented letter or
 * special space would switch the whole message to Unicode (70 characters).
 */
const toGsm = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatLagos = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Request timed out')),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const toNumber = (value: Prisma.Decimal | null | undefined): number | null =>
  value == null ? null : Number(value);

const unitLabel = (
  unit: { building: string | null; unitNumber: string } | null | undefined,
): string | null =>
  unit ? [unit.building, unit.unitNumber].filter(Boolean).join(' ') : null;

/** Only the unit fields that are safe to show to the host and the gate. */
const UNIT_LABEL_SELECT = {
  id: true,
  unitNumber: true,
  building: true,
} satisfies Prisma.EstateUnitSelect;

@Injectable()
export class VisitorsService {
  private readonly log = new Logger(VisitorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly permissions: PermissionsService,
    private readonly hours: OrgHoursService,
    private readonly sms: SmsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verify the organization is an estate and the user holds the permission.
   */
  private async assertEstate(
    user: AuthUser,
    organizationId: string,
    permission: Permission,
  ) {
    const organization = await this.orgs.getOrThrow(organizationId);

    if (organization.type !== 'ESTATE') {
      throw new BadRequestException(
        'Visitor passes are only available for estates.',
      );
    }

    await this.permissions.assert(user, organizationId, permission);

    return organization;
  }

  /** Public link for the visitor's map page, or null if no base URL is set. */
  private directionsUrl(code: string): string | null {
    const base = this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/+$/, '');

    if (!base) {
      this.log.warn('APP_PUBLIC_URL is not set; directions link omitted.');
      return null;
    }

    return `${base}/v/${code}`;
  }

  private async assertSmsAllowance(hostId: string): Promise<void> {
    const sentToday = await this.prisma.visitorPass.count({
      where: {
        hostId,
        smsSentAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    if (sentToday >= MAX_PASS_SMS_PER_DAY) {
      throw new HttpException(
        'You have reached the daily limit for visitor SMS. Share the code yourself or try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertEmailAllowance(hostId: string): Promise<void> {
    // Passes created with a visitor email in the last 24 hours.
    const recent = await this.prisma.visitorPass.count({
      where: {
        hostId,
        visitorEmail: { not: null },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    if (recent >= MAX_PASS_EMAIL_PER_DAY) {
      throw new HttpException(
        'You have reached the daily limit for visitor emails. Share the message yourself or try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Rich text for copy and paste, WhatsApp and the like. */
  private buildShareText(a: {
    visitorName: string;
    hostName: string;
    estateName: string;
    code: string;
    validUntil: Date;
    directionsUrl: string | null;
  }): string {
    return (
      `Hi ${a.visitorName}, ${a.hostName} has invited you to ${a.estateName}.\n` +
      `Pass code: ${a.code}\n` +
      (a.directionsUrl ? `Directions: ${a.directionsUrl}\n` : '') +
      `Valid until ${formatLagos(a.validUntil)}.\n` +
      `Show this code to security at the gate.`
    );
  }

  /** Compact version so the SMS stays within one or two parts. */
  private buildSmsText(a: {
    visitorName: string;
    hostName: string;
    estateName: string;
    code: string;
    validUntil: Date;
    directionsUrl: string | null;
  }): string {
    return toGsm(
      `Hi ${a.visitorName}, ${a.hostName} invited you to ${a.estateName}. ` +
        `Pass code: ${a.code}. ` +
        (a.directionsUrl ? `Directions: ${a.directionsUrl} ` : '') +
        `Valid until ${formatLagos(a.validUntil)}.`,
    );
  }

  private buildEmailHtml(a: {
    visitorName: string;
    hostName: string;
    estateName: string;
    code: string;
    validUntil: Date;
    directionsUrl: string | null;
  }): string {
    const link = a.directionsUrl
      ? `<p><a href="${escapeHtml(a.directionsUrl)}" style="display:inline-block;padding:10px 18px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px">Get directions</a></p>` +
        `<p style="font-size:12px;color:#666666">Or open this link: ${escapeHtml(a.directionsUrl)}</p>`
      : '';

    return (
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111111">` +
      `<h2>${escapeHtml(a.estateName)}</h2>` +
      `<p>Hi ${escapeHtml(a.visitorName)},</p>` +
      `<p>${escapeHtml(a.hostName)} has invited you. Show this code to security at the gate:</p>` +
      `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${escapeHtml(a.code)}</p>` +
      `<p>Valid until ${escapeHtml(formatLagos(a.validUntil))}.</p>` +
      link +
      `</div>`
    );
  }

  /**
   * Sends the pass SMS. Never throws: a failed SMS must not undo a pass that
   * was already created. Returns whether the provider accepted the message.
   */
  private async sendPassSms(args: {
    passId: string;
    phone: string;
    message: string;
  }): Promise<boolean> {
    try {
      await withTimeout(
        this.sms.send(args.phone, args.message),
        SEND_TIMEOUT_MS,
      );
    } catch (error) {
      // The message holds the pass code, so it is never logged.
      this.log.warn(`Pass SMS failed: ${(error as Error).message}`);
      return false;
    }

    try {
      await this.prisma.visitorPass.update({
        where: { id: args.passId },
        data: { smsSentAt: new Date() },
      });
    } catch (error) {
      this.log.warn(`Could not record SMS time: ${(error as Error).message}`);
    }

    return true;
  }

  /** Never throws. MailService already returns false on provider errors. */
  private async sendPassEmail(args: {
    to: string;
    estateName: string;
    html: string;
  }): Promise<boolean> {
    try {
      const subject = `Your visitor pass for ${args.estateName}`.replace(
        /[\r\n]+/g,
        ' ',
      );

      return await withTimeout(
        this.mail.send(args.to, subject, args.html),
        SEND_TIMEOUT_MS,
      );
    } catch (error) {
      this.log.warn(`Pass email failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Resolve the unit a pass is going to. The host must own it or currently
   * occupy it, and it must belong to the same estate as the pass.
   * When directions will be shared, the unit must also be pinned on the map.
   */
  private async resolveDestinationUnit(
    hostId: string,
    organizationId: string,
    unitId: string,
    requireCoordinates: boolean,
  ) {
    const now = new Date();

    const unit = await this.prisma.estateUnit.findFirst({
      where: {
        id: unitId,
        organizationId,
        isActive: true,
        OR: [
          { ownerId: hostId },
          {
            occupancies: {
              some: {
                userId: hostId,
                startAt: { lte: now },
                OR: [{ endAt: null }, { endAt: { gt: now } }],
              },
            },
          },
        ],
      },
      select: { id: true, latitude: true, longitude: true },
    });

    if (!unit) {
      throw new NotFoundException('Unit not found.');
    }

    if (requireCoordinates && (unit.latitude == null || unit.longitude == null)) {
      throw new BadRequestException(
        'This unit has no map location yet. Pin it on the map before sharing directions.',
      );
    }

    return unit;
  }

  async create(user: AuthUser, dto: CreatePassDto) {
    const organization = await this.assertEstate(
      user,
      dto.organizationId,
      'visitor.create',
    );

    const hostId = user.id;
    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);

    if (
      Number.isNaN(validFrom.getTime()) ||
      Number.isNaN(validUntil.getTime()) ||
      validUntil <= validFrom
    ) {
      throw new BadRequestException(
        'validUntil must be a valid date after validFrom.',
      );
    }

    const maxEntries = dto.maxEntries ?? 1;

    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new BadRequestException('maxEntries must be a positive integer.');
    }

    const shareDirections = dto.shareDirections === true;

    if (shareDirections && !dto.unitId) {
      throw new BadRequestException(
        'Choose which unit the visitor is going to before sharing directions.',
      );
    }

    let destinationUnitId: string | undefined;

    if (dto.unitId) {
      const unit = await this.resolveDestinationUnit(
        hostId,
        dto.organizationId,
        dto.unitId,
        shareDirections,
      );

      destinationUnitId = unit.id;
    }

    let smsPhone: string | null = null;

    if (dto.sendSms) {
      smsPhone = normalizePhone(dto.visitorPhone);

      if (!smsPhone) {
        throw new BadRequestException(
          'Enter a valid phone number for the visitor to send them an SMS.',
        );
      }

      await this.assertSmsAllowance(hostId);
    }

    const visitorEmail = dto.visitorEmail?.trim().toLowerCase() || undefined;

    if (dto.sendEmail) {
      if (!visitorEmail) {
        throw new BadRequestException(
          'Enter the visitor\'s email address to send them an email.',
        );
      }

      await this.assertEmailAllowance(hostId);
    }

    const host = await this.prisma.user.findUnique({
      where: { id: hostId },
      select: { firstName: true },
    });

    const hostName = host?.firstName?.trim() || 'A resident';

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const codeHash = hashCode(code);

      try {
        const pass = await this.prisma.visitorPass.create({
          data: {
            codeHash,
            organizationId: dto.organizationId,
            hostId,
            createdById: hostId,
            visitorName: dto.visitorName.trim(),
            visitorPhone: dto.visitorPhone?.trim(),
            visitorEmail,
            purpose: dto.purpose?.trim(),
            validFrom,
            validUntil,
            maxEntries,
            destinationUnitId,
            shareDirections,
          },
          omit: { codeHash: true },
          include: { destinationUnit: { select: UNIT_LABEL_SELECT } },
        });

        const directionsUrl = shareDirections ? this.directionsUrl(code) : null;

        const content = {
          visitorName: pass.visitorName,
          hostName,
          estateName: organization.name,
          code,
          validUntil,
          directionsUrl,
        };

        // Ready-made text the app can copy, or open straight in WhatsApp.
        const shareMessage = this.buildShareText(content);
        const whatsappPhone = normalizePhone(dto.visitorPhone);
        const whatsappUrl = `https://wa.me/${
          whatsappPhone ? whatsappPhone.slice(1) : ''
        }?text=${encodeURIComponent(shareMessage)}`;

        const [smsSent, emailSent] = await Promise.all([
          smsPhone
            ? this.sendPassSms({
                passId: pass.id,
                phone: smsPhone,
                message: this.buildSmsText(content),
              })
            : null,
          dto.sendEmail && visitorEmail
            ? this.sendPassEmail({
                to: visitorEmail,
                estateName: organization.name,
                html: this.buildEmailHtml(content),
              })
            : null,
        ]);

        // The readable code is returned only once, at creation, so the app
        // should show shareMessage / whatsappUrl right away.
        // smsSent and emailSent are null when that channel was not requested.
        return {
          ...pass,
          code,
          directionsUrl,
          shareMessage,
          whatsappUrl,
          smsSent,
          emailSent,
        };
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Retry if the generated code collides with an existing codeHash.
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException(
      'Could not generate a unique visitor pass. Please try again.',
    );
  }

  async mine(hostId: string) {
    return this.prisma.visitorPass.findMany({
      where: { hostId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      omit: { codeHash: true },
      include: { destinationUnit: { select: UNIT_LABEL_SELECT } },
    });
  }

  async revoke(hostId: string, id: string) {
    const pass = await this.prisma.visitorPass.findFirst({
      where: { id, hostId },
    });

    if (!pass) {
      throw new NotFoundException('Pass not found.');
    }

    if (pass.status === 'REVOKED') {
      throw new BadRequestException('This pass has already been revoked.');
    }

    if (pass.status === 'COMPLETED') {
      throw new BadRequestException('A completed pass cannot be revoked.');
    }

    return this.prisma.visitorPass.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
      omit: { codeHash: true },
    });
  }

  /**
   * Public, code-based lookup used by the visitor's link.
   * Returns the map data only when the host chose to share directions and the
   * pass is still usable. Every failure returns the same generic error so
   * codes cannot be probed.
   */
  async directions(rawCode: string) {
    const unavailable = () =>
      new NotFoundException('No directions available for this pass.');

    const code = normalizeCode(rawCode ?? '');

    if (code.length !== 6) {
      throw unavailable();
    }

    const pass = await this.prisma.visitorPass.findFirst({
      where: { codeHash: hashCode(code) },
      select: {
        status: true,
        visitorName: true,
        validFrom: true,
        validUntil: true,
        shareDirections: true,
        organization: {
          select: {
            name: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
        destinationUnit: {
          select: {
            unitNumber: true,
            building: true,
            latitude: true,
            longitude: true,
            directions: true,
            routeGeoJson: true,
          },
        },
        host: { select: { firstName: true } },
      },
    });

    if (!pass || !pass.shareDirections || !pass.destinationUnit) {
      throw unavailable();
    }

    // COMPLETED is allowed on purpose: after the gate scan the visitor still
    // needs directions inside the estate.
    if (pass.status === 'REVOKED' || pass.status === 'EXPIRED') {
      throw unavailable();
    }

    if (new Date() > pass.validUntil) {
      throw unavailable();
    }

    const { organization: org, destinationUnit: unit } = pass;

    const destLat = toNumber(unit.latitude);
    const destLng = toNumber(unit.longitude);

    if (destLat == null || destLng == null) {
      throw unavailable();
    }

    return {
      visitorName: pass.visitorName,
      hostFirstName: pass.host.firstName,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      gate: {
        name: org.name,
        address: org.address,
        latitude: toNumber(org.latitude),
        longitude: toNumber(org.longitude),
      },
      destination: {
        label: unitLabel(unit),
        latitude: destLat,
        longitude: destLng,
        directions: unit.directions,
        route: unit.routeGeoJson,
      },
    };
  }

  async verify(user: AuthUser, dto: VerifyPassDto) {
    await this.assertEstate(user, dto.organizationId, 'visitor.verify');

    // Entry is only allowed during the estate's visiting hours.
    await this.hours.assertOpen(
      dto.organizationId,
      'VISITING',
      'Visitors cannot be admitted outside visiting hours',
    );

    const securityId = user.id;
    const code = normalizeCode(dto.code);

    const pass = await this.prisma.visitorPass.findFirst({
      where: {
        codeHash: hashCode(code),
        organizationId: dto.organizationId,
      },
      include: {
        host: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
            phone: true,
          },
        },
        destinationUnit: { select: UNIT_LABEL_SELECT },
      },
    });

    if (!pass) {
      throw new NotFoundException('Invalid visitor pass code.');
    }

    const now = new Date();

    if (pass.status === 'REVOKED') {
      throw new BadRequestException('This pass was revoked.');
    }

    if (pass.status === 'COMPLETED' || pass.entriesUsed >= pass.maxEntries) {
      throw new BadRequestException('This pass has already been used.');
    }

    if (now < pass.validFrom) {
      throw new BadRequestException('This pass is not valid yet.');
    }

    if (now > pass.validUntil) {
      await this.prisma.visitorPass.update({
        where: { id: pass.id },
        data: { status: 'EXPIRED' },
      });

      throw new BadRequestException('This pass has expired.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional update prevents two simultaneous scans from consuming
      // the same remaining entry.
      const updatedCount = await tx.visitorPass.updateMany({
        where: {
          id: pass.id,
          entriesUsed: pass.entriesUsed,
          status: { notIn: ['REVOKED', 'COMPLETED', 'EXPIRED'] },
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
        data: {
          entriesUsed: { increment: 1 },
          status:
            pass.entriesUsed + 1 >= pass.maxEntries ? 'COMPLETED' : 'ACTIVE',
        },
      });

      if (updatedCount.count !== 1) {
        throw new ConflictException(
          'The pass has changed or has already been used. Please scan again.',
        );
      }

      const updatedPass = await tx.visitorPass.findUniqueOrThrow({
        where: { id: pass.id },
        omit: { codeHash: true },
      });

      await tx.gateLog.create({
        data: {
          organizationId: pass.organizationId,
          passId: pass.id,
          securityId,
          action: 'ENTRY',
          visitorName: pass.visitorName,
        },
      });

      await tx.notification.create({
        data: {
          userId: pass.hostId,
          type: 'VISITOR_PASS',
          title: 'Visitor arrived',
          body: `${pass.visitorName} has been admitted at the gate.`,
        },
      });

      return updatedPass;
    });

    return {
      valid: true,
      visitorName: pass.visitorName,
      purpose: pass.purpose,
      host: pass.host,
      // Security sees only the unit label, never the map coordinates.
      destination: unitLabel(pass.destinationUnit),
      pass: result,
    };
  }

  async exit(user: AuthUser, dto: VerifyPassDto) {
    // Exit is always allowed, even outside visiting hours.
    await this.assertEstate(user, dto.organizationId, 'visitor.verify');

    const pass = await this.prisma.visitorPass.findFirst({
      where: {
        codeHash: hashCode(normalizeCode(dto.code)),
        organizationId: dto.organizationId,
      },
    });

    if (!pass) {
      throw new NotFoundException('Invalid visitor pass code.');
    }

    await this.prisma.gateLog.create({
      data: {
        organizationId: pass.organizationId,
        passId: pass.id,
        securityId: user.id,
        action: 'EXIT',
        visitorName: pass.visitorName,
      },
    });

    return {
      ok: true,
      visitorName: pass.visitorName,
    };
  }

  async gateLog(user: AuthUser, organizationId: string) {
    await this.assertEstate(user, organizationId, 'gate.view');

    return this.prisma.gateLog.findMany({
      where: { organizationId },
      include: {
        pass: {
          select: {
            visitorName: true,
            host: {
              select: {
                id: true,
                firstName: true,
                otherNames: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Marks passes whose validity window has ended as EXPIRED.
   * Needs ScheduleModule.forRoot() in AppModule.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireStalePasses(): Promise<void> {
    try {
      const result = await this.prisma.visitorPass.updateMany({
        where: { status: 'ACTIVE', validUntil: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });

      if (result.count > 0) {
        this.log.log(`Expired ${result.count} visitor pass(es)`);
      }
    } catch (error) {
      this.log.error(
        `Failed to expire visitor passes: ${(error as Error).message}`,
      );
    }
  }
}