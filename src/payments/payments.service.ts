import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GivingType, Payment, PaymentMethod, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { WalletService } from '../wallet/wallet.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GiveOnlineDto } from '../church/dto/church.dto';

const CHANNEL_TO_METHOD: Record<string, PaymentMethod> = {
  card: 'CARD',
  bank_transfer: 'BANK_TRANSFER',
  bank: 'BANK_TRANSFER',
  ussd: 'USSD',
};

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private orders: OrdersService,
    private wallet: WalletService,
    private permissions: PermissionsService,
  ) {}

  get secret(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key)
      throw new BadGatewayException('Online payments are not configured');
    return key;
  }

  private async paystack<T>(
    path: string,
    init: { method?: string; body?: string } = {},
  ): Promise<T> {
    const res = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
      },
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.status)
      throw new BadGatewayException(json?.message ?? 'Payment provider error');
    return json.data as T;
  }

  /** Start an online payment for a PENDING order. */
  async initialize(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, customer: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== userId) throw new ForbiddenException();
    if (order.status !== 'PENDING')
      throw new BadRequestException('This order can no longer be paid');
    if (order.payments.some((p) => p.method === 'CASH'))
      throw new BadRequestException('This order is pay-on-delivery');
    if (order.payments.some((p) => p.status === 'SUCCEEDED'))
      throw new BadRequestException('Order is already paid');

    // abandon earlier attempts, Paystack references must be unique per attempt
    await this.prisma.payment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });

    const reference = `${order.orderNumber}-${randomBytes(3).toString('hex')}`;
    const payment = await this.prisma.payment.create({
      data: {
        organizationId: order.organizationId,
        orderId,
        payerId: userId,
        amount: order.totalAmount,
        method: 'CARD',
        status: 'PENDING',
        provider: 'paystack',
        providerRef: reference,
        purpose: 'ORDER',
      },
    });

    try {
      const data = await this.paystack<{
        authorization_url: string;
        access_code: string;
        reference: string;
      }>('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email:
            order.customer.email ??
            `user-${order.customer.id}@pay.neighborhood.app`, // Paystack requires an email
          amount: order.totalAmount.mul(100).toFixed(0), // kobo
          currency: order.currency,
          reference,
          callback_url: this.config.get('PAYSTACK_CALLBACK_URL') || undefined,
          metadata: { orderId, orderNumber: order.orderNumber },
        }),
      });
      return {
        reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (e) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      throw e;
    }
  }

  /** Start a card payment that adds credit to an organization's wallet. */
  async initializeTopup(user: AuthUser, organizationId: string, amount: number) {
    await this.permissions.assert(user, organizationId, 'wallet.manage');

    const payer = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    const decimal = new Prisma.Decimal(amount.toFixed(2));
    const reference = `TOPUP-${randomBytes(6).toString('hex')}`;

    const payment = await this.prisma.payment.create({
      data: {
        organizationId,
        payerId: user.id,
        amount: decimal,
        method: 'CARD',
        status: 'PENDING',
        provider: 'paystack',
        providerRef: reference,
        purpose: 'WALLET_FUNDING',
      },
    });

    try {
      const data = await this.paystack<{
        authorization_url: string;
        access_code: string;
        reference: string;
      }>('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: payer.email ?? `user-${payer.id}@pay.neighborhood.app`,
          amount: decimal.mul(100).toFixed(0), // kobo
          currency: payment.currency,
          reference,
          callback_url: this.config.get('PAYSTACK_CALLBACK_URL') || undefined,
          metadata: { purpose: 'wallet_topup', organizationId },
        }),
      });

      return {
        reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (e) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      throw e;
    }
  }

  /** Start a card payment for giving: tithe, offering, donation or a pledge payment. */
  async initializeGiving(
    user: AuthUser,
    organizationId: string,
    dto: GiveOnlineDto,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true, isActive: true },
    });

    if (!org?.isActive || (org.type !== 'CHURCH' && org.type !== 'MOSQUE')) {
      throw new BadRequestException(
        'Online giving is only available for churches and mosques.',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      select: { status: true },
    });

    if (membership?.status !== 'APPROVED') {
      throw new ForbiddenException('Only approved members can give online.');
    }

    if (dto.pledgeId) {
      const pledge = await this.prisma.pledge.findFirst({
        where: {
          id: dto.pledgeId,
          organizationId,
          churchMember: { userId: user.id },
          status: { in: ['OPEN', 'PARTIALLY_PAID'] },
        },
        select: { id: true },
      });

      if (!pledge) {
        throw new BadRequestException('Pledge not found or already closed.');
      }
    }

    const payer = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    const decimal = new Prisma.Decimal(dto.amount.toFixed(2));
    const reference = `GIVE-${randomBytes(6).toString('hex')}`;

    const payment = await this.prisma.payment.create({
      data: {
        organizationId,
        payerId: user.id,
        amount: decimal,
        method: 'CARD',
        status: 'PENDING',
        provider: 'paystack',
        providerRef: reference,
        purpose: 'GIVING',
        metadata: {
          type: dto.pledgeId ? 'PLEDGE' : (dto.type ?? 'DONATION'),
          isAnonymous: !!dto.isAnonymous,
          pledgeId: dto.pledgeId ?? null,
        },
      },
    });

    try {
      const data = await this.paystack<{
        authorization_url: string;
        access_code: string;
        reference: string;
      }>('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: payer.email ?? `user-${payer.id}@pay.neighborhood.app`,
          amount: decimal.mul(100).toFixed(0), // kobo
          currency: payment.currency,
          reference,
          callback_url: this.config.get('PAYSTACK_CALLBACK_URL') || undefined,
          metadata: { purpose: 'giving', organizationId },
        }),
      });

      return {
        reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (e) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      throw e;
    }
  }

  /** Runs inside the settle transaction once Paystack confirms a gift. */
  private async recordOnlineGiving(
    tx: Prisma.TransactionClient,
    payment: Payment,
  ) {
    if (!payment.organizationId || !payment.payerId) {
      throw new Error(`Giving payment ${payment.id} is missing its organization or payer`);
    }

    const meta = (payment.metadata ?? {}) as {
      type?: GivingType;
      isAnonymous?: boolean;
      pledgeId?: string | null;
    };

    const member = await tx.churchMember.upsert({
      where: {
        userId_organizationId: {
          userId: payment.payerId,
          organizationId: payment.organizationId,
        },
      },
      create: {
        userId: payment.payerId,
        organizationId: payment.organizationId,
        joinedAt: new Date(),
      },
      update: {},
    });

    await tx.givingRecord.create({
      data: {
        organizationId: payment.organizationId,
        churchMemberId: member.id,
        type: meta.pledgeId ? 'PLEDGE' : (meta.type ?? 'DONATION'),
        amount: payment.amount,
        currency: payment.currency,
        // Unique, so a repeated settle can never record the gift twice.
        reference: `paystack:${payment.id}`,
        isAnonymous: !!meta.isAnonymous,
        notes: 'Online giving',
      },
    });

    if (meta.pledgeId) {
      const pledge = await tx.pledge.findFirst({
        where: {
          id: meta.pledgeId,
          organizationId: payment.organizationId,
          churchMemberId: member.id,
          status: { in: ['OPEN', 'PARTIALLY_PAID'] },
        },
      });

      if (pledge) {
        const paid = pledge.amountPaid.add(payment.amount);

        await tx.pledge.update({
          where: { id: pledge.id },
          data: {
            amountPaid: paid,
            status: paid.gte(pledge.targetAmount) ? 'FULFILLED' : 'PARTIALLY_PAID',
          },
        });
      }
    }
  }

  /** Verifies with Paystack and settles. Safe to call many times (webhook + app callback). */
  async settle(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: reference },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'SUCCEEDED') return payment;

    const data = await this.paystack<{
      status: string;
      amount: number;
      currency: string;
      channel: string;
      paid_at?: string;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);

    if (data.status !== 'success') {
      if (
        ['failed', 'abandoned', 'reversed'].includes(data.status) &&
        payment.status === 'PENDING'
      ) {
        return this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' },
        });
      }
      return payment; // still ongoing
    }

    if (
      String(data.amount) !== payment.amount.mul(100).toFixed(0) ||
      data.currency !== payment.currency
    ) {
      this.log.error(
        `Amount mismatch for ${reference}: got ${data.amount} ${data.currency}, expected ${payment.amount} ${payment.currency}`,
      );
      throw new BadRequestException('Payment amount mismatch');
    }

    let late: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: 'SUCCEEDED' } },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(data.paid_at ?? Date.now()),
          method: CHANNEL_TO_METHOD[data.channel] ?? 'OTHER',
        },
      });
      if (claimed.count === 0) return { fresh: false }; // another request settled it first

      if (payment.purpose === 'WALLET_FUNDING') {
        if (!payment.organizationId) {
          throw new Error(`Top-up ${payment.id} has no organization`);
        }

        // The reference is unique, so a repeat can never credit twice.
        await this.wallet.credit(
          tx,
          payment.organizationId,
          payment.amount,
          'TOPUP',
          'Wallet top-up',
          `topup:${payment.id}`,
        );
      } else if (payment.purpose === 'GIVING') {
        await this.recordOnlineGiving(tx, payment);
      } else if (payment.orderId) {
        const r = await this.orders.confirmOrderTx(tx, payment.orderId);
        if (!r.confirmed) late = String(r.reason);
      }

      return { fresh: true };
    });

    if (result.fresh && payment.purpose === 'ORDER' && payment.orderId)
      await this.orders.notifyPaid(payment.orderId, late);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  async status(userId: string, reference: string) {
    const p = await this.prisma.payment.findUnique({
      where: { providerRef: reference },
    });
    if (!p || p.payerId !== userId)
      throw new NotFoundException('Payment not found');
    return this.settle(reference); // verify live so the app shows the truth right after redirect
  }
}