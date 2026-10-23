import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipRole, Prisma, SmsCampaign } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SmsService } from '../sms1/sms.service';
import { WalletService } from '../wallet/wallet.service';
import { SmsBroadcastDto } from './dto/sms-broadcast.dto';

const MAX_SEGMENTS = 6;
const MAX_RECIPIENTS = 2000;
const SEND_CONCURRENCY = 5;

/**
 * Estimated number of SMS parts. Plain text fits 160 characters in one
 * part, then 153 per part. Any non-ASCII character (including the naira
 * sign) switches the message to Unicode: 70, then 67 per part.
 * The provider's own count may differ slightly for special characters.
 */
export function smsSegments(text: string): number {
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const length = [...text].length;

  return length <= single ? 1 : Math.ceil(length / multi);
}

@Injectable()
export class SmsCampaignsService {
  private readonly log = new Logger(SmsCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionsService,
    private readonly sms: SmsService,
    private readonly wallet: WalletService,
  ) {}

  /** What you charge per SMS part. Must be set above your provider's cost. */
  private unitPrice(): Prisma.Decimal {
    const raw = Number(this.config.getOrThrow<string>('SMS_PRICE_PER_SEGMENT'));

    if (!Number.isFinite(raw) || raw <= 0) {
      throw new Error('SMS_PRICE_PER_SEGMENT must be a positive number');
    }

    return new Prisma.Decimal(raw.toFixed(2));
  }

  private async recipients(
    organizationId: string,
    roles?: MembershipRole[],
  ): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        ...(roles?.length ? { role: { in: roles } } : {}),
        user: { isActive: true },
      },
      select: { user: { select: { phone: true } } },
    });

    return [...new Set(rows.map((row) => row.user.phone))];
  }

  private async quote(organizationId: string, dto: SmsBroadcastDto) {
    const body = dto.body.trim();

    if (!body) {
      throw new BadRequestException('Message cannot be empty.');
    }

    const segments = smsSegments(body);

    if (segments > MAX_SEGMENTS) {
      throw new BadRequestException(
        `Message is too long: it would take ${segments} SMS parts (maximum ${MAX_SEGMENTS}).`,
      );
    }

    const phones = await this.recipients(organizationId, dto.roles);

    if (phones.length === 0) {
      throw new BadRequestException('No members match this audience.');
    }

    if (phones.length > MAX_RECIPIENTS) {
      throw new BadRequestException(
        `Too many recipients (${phones.length}). Narrow the audience to ${MAX_RECIPIENTS} or fewer.`,
      );
    }

    const unitPrice = this.unitPrice();
    const cost = unitPrice.mul(segments).mul(phones.length);

    return { body, segments, phones, unitPrice, cost };
  }

  private summary(campaign: SmsCampaign) {
    return {
      id: campaign.id,
      status: campaign.status,
      recipients: campaign.recipientCount,
      segments: campaign.segments,
      cost: campaign.cost.toFixed(2),
      sent: campaign.sentCount,
      failed: campaign.failedCount,
      refunded: campaign.refunded.toFixed(2),
    };
  }

  /** Shows the price and balance before anything is charged. */
  async estimate(user: AuthUser, organizationId: string, dto: SmsBroadcastDto) {
    await this.permissions.assert(user, organizationId, 'sms.broadcast');

    const q = await this.quote(organizationId, dto);
    const balance = await this.wallet.balance(organizationId);

    return {
      recipients: q.phones.length,
      segments: q.segments,
      unitPrice: q.unitPrice.toFixed(2),
      cost: q.cost.toFixed(2),
      balance: balance.toFixed(2),
      canAfford: balance.gte(q.cost),
    };
  }

  async send(user: AuthUser, organizationId: string, dto: SmsBroadcastDto) {
    await this.permissions.assert(user, organizationId, 'sms.broadcast');

    if (dto.idempotencyKey) {
      const existing = await this.prisma.smsCampaign.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });

      if (existing) return this.summary(existing);
    }

    const q = await this.quote(organizationId, dto);

    let campaign: SmsCampaign;

    try {
      // Charging and creating the campaign succeed or fail together.
      campaign = await this.prisma.$transaction(async (tx) => {
        const created = await tx.smsCampaign.create({
          data: {
            organizationId,
            senderId: user.id,
            body: q.body,
            recipientCount: q.phones.length,
            segments: q.segments,
            unitPrice: q.unitPrice,
            cost: q.cost,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        const charged = await this.wallet.debit(
          tx,
          organizationId,
          q.cost,
          'SMS_CHARGE',
          `SMS to ${q.phones.length} member(s)`,
          `sms:${created.id}`,
        );

        if (!charged) {
          throw new HttpException(
            {
              statusCode: 402,
              error: 'Payment Required',
              message:
                'Not enough SMS credit. Top up the organization wallet and try again.',
              required: q.cost.toFixed(2),
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        return created;
      });
    } catch (error) {
      // Two requests with the same idempotency key raced. Return the winner.
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.smsCampaign.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });

        if (existing) return this.summary(existing);
      }

      throw error;
    }

    // Delivery continues in the background so the request returns at once.
    void this.deliver(campaign, q.phones).catch((error: Error) =>
      this.log.error(`Campaign ${campaign.id} failed: ${error.message}`),
    );

    return this.summary(campaign);
  }

  /**
   * Sends to every number a few at a time. Numbers the provider rejects are
   * refunded. A phone that is switched off still counts as sent, because
   * the API accepted it.
   */
  private async deliver(campaign: SmsCampaign, phones: string[]) {
    let sent = 0;
    let failed = 0;
    const queue = [...phones];

    const worker = async () => {
      while (queue.length > 0) {
        const phone = queue.shift()!;

        try {
          await this.sms.send(phone, campaign.body);
          sent++;
        } catch (error) {
          failed++;
          this.log.warn(
            `SMS failed in campaign ${campaign.id}: ${(error as Error).message}`,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));

    const refund = campaign.unitPrice.mul(campaign.segments).mul(failed);

    await this.prisma.$transaction(async (tx) => {
      if (failed > 0) {
        await this.wallet.credit(
          tx,
          campaign.organizationId,
          refund,
          'SMS_REFUND',
          `Refund for ${failed} SMS that could not be sent`,
          `refund:${campaign.id}`,
        );
      }

      await tx.smsCampaign.update({
        where: { id: campaign.id },
        data: {
          sentCount: sent,
          failedCount: failed,
          refunded: refund,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    });
  }

  async list(user: AuthUser, organizationId: string) {
    await this.permissions.assert(user, organizationId, 'sms.broadcast');

    const campaigns = await this.prisma.smsCampaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return campaigns.map((campaign) => ({
      ...this.summary(campaign),
      body: campaign.body,
      createdAt: campaign.createdAt,
      completedAt: campaign.completedAt,
    }));
  }
}
