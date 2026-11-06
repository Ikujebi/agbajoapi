
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GivingType,
  Payment,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { WalletService } from '../wallet/wallet.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GiveOnlineDto } from '../church/dto/church.dto';

import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';

import {
  walletTopupTemplate,
  givingConfirmationTemplate,
} from '../mail/templates';

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
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
    private readonly wallet: WalletService,
    private readonly permissions: PermissionsService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
  ) {}

  get secret(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');

    if (!key) {
      throw new BadGatewayException(
        'Online payments are not configured',
      );
    }

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

    if (!res.ok || !json?.status) {
      throw new BadGatewayException(
        json?.message ?? 'Payment provider error',
      );
    }

    return json.data as T;
  }

  /**
   * Sends an email without allowing email-provider failures
   * to interfere with successful payment settlement.
   */
  private async sendEmailSafely(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    try {
      const sent = await this.mail.send(to, subject, html);

      if (!sent) {
        this.log.warn(
          `Payment email was not accepted for ${to}`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown email error';

      this.log.error(
        `Payment email failed for ${to}: ${message}`,
      );
    }
  }

  /**
   * Sends wallet top-up or online giving confirmation emails.
   * Called only after successful payment settlement.
   */
  private async sendNonOrderPaymentEmail(
    payment: Payment,
    walletBalance?: string,
  ): Promise<void> {
    if (!payment.payerId || !payment.organizationId) {
      return;
    }

    try {
      const [payer, organization] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: payment.payerId },
          select: {
            email: true,
            firstName: true,
          },
        }),

        this.prisma.organization.findUnique({
          where: { id: payment.organizationId },
          select: {
            name: true,
          },
        }),
      ]);

      // Fix: payer may be null.
      if (!payer) {
        this.log.warn(
          `Payer ${payment.payerId} not found for payment ${payment.id}`,
        );
        return;
      }

      const email = payer.email?.trim();

      // Do not send to synthetic addresses used for Paystack.
      if (
        !email ||
        email.toLowerCase().endsWith('@pay.neighborhood.app')
      ) {
        return;
      }

      const recipientName = payer.firstName || undefined;

      const organizationName =
        organization?.name || 'your organization';

      const amount = payment.amount.toFixed(2);
      const currency = payment.currency || 'NGN';

      // WALLET TOP-UP CONFIRMATION
      if (payment.purpose === 'WALLET_FUNDING') {
        if (walletBalance === undefined) {
          this.log.warn(
            `Wallet balance unavailable for payment ${payment.id}`,
          );
          return;
        }

        const html = this.mailTemplates.render(
          walletTopupTemplate,
          {
            recipientName,
            organizationName,
            amount,
            currency,
            newBalance: walletBalance,

            // Fix: providerRef may be null.
            paymentReference:
              payment.providerRef ?? payment.id,

            paidAt: payment.paidAt ?? new Date(),
          },
        );

        await this.sendEmailSafely(
          email,
          'Your AdugboHub wallet top-up was successful',
          html,
        );

        return;
      }

      // ONLINE GIVING CONFIRMATION
      if (payment.purpose === 'GIVING') {
        const metadata = (payment.metadata ?? {}) as {
          type?: GivingType;
          isAnonymous?: boolean;
          pledgeId?: string | null;
        };

        const givingType = metadata.pledgeId
          ? 'PLEDGE'
          : metadata.type ?? 'DONATION';

        const html = this.mailTemplates.render(
          givingConfirmationTemplate,
          {
            recipientName,
            organizationName,
            givingType,
            amount,
            currency,

            // Fix: providerRef may be null.
            paymentReference:
              payment.providerRef ?? payment.id,

            paidAt: payment.paidAt ?? new Date(),
            isPledgePayment: !!metadata.pledgeId,
          },
        );

        await this.sendEmailSafely(
          email,
          'Your online giving payment has been confirmed',
          html,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown email error';

      this.log.error(
        `Could not prepare payment confirmation email for ${payment.id}: ${message}`,
      );
    }
  }

  /** Start an online payment for a PENDING order. */
  async initialize(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        customer: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.customerId !== userId) {
      throw new ForbiddenException();
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        'This order can no longer be paid',
      );
    }

    if (order.payments.some((p) => p.method === 'CASH')) {
      throw new BadRequestException(
        'This order is pay-on-delivery',
      );
    }

    if (order.payments.some((p) => p.status === 'SUCCEEDED')) {
      throw new BadRequestException('Order is already paid');
    }

    // Abandon earlier attempts.
    // Paystack references must be unique per attempt.
    await this.prisma.payment.updateMany({
      where: {
        orderId,
        status: 'PENDING',
      },
      data: {
        status: 'FAILED',
      },
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
            `user-${order.customer.id}@pay.neighborhood.app`,
          amount: order.totalAmount.mul(100).toFixed(0),
          currency: order.currency,
          reference,
          callback_url:
            this.config.get('PAYSTACK_CALLBACK_URL') || undefined,
          metadata: {
            orderId,
            orderNumber: order.orderNumber,
          },
        }),
      });

      return {
        reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  /** Start a card payment that adds credit to an organization's wallet. */
  async initializeTopup(
    user: AuthUser,
    organizationId: string,
    amount: number,
  ) {
    await this.permissions.assert(
      user,
      organizationId,
      'wallet.manage',
    );

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
          email:
            payer.email ??
            `user-${payer.id}@pay.neighborhood.app`,
          amount: decimal.mul(100).toFixed(0),
          currency: payment.currency,
          reference,
          callback_url:
            this.config.get('PAYSTACK_CALLBACK_URL') || undefined,
          metadata: {
            purpose: 'wallet_topup',
            organizationId,
          },
        }),
      });

      return {
        reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  /** Start a card payment for giving: tithe, offering, donation or pledge. */
  async initializeGiving(
    user: AuthUser,
    organizationId: string,
    dto: GiveOnlineDto,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        type: true,
        isActive: true,
      },
    });

    if (
      !org?.isActive ||
      (org.type !== 'CHURCH' && org.type !== 'MOSQUE')
    ) {
      throw new BadRequestException(
        'Online giving is only available for churches and mosques.',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId,
        },
      },
      select: {
        status: true,
      },
    });

    if (membership?.status !== 'APPROVED') {
      throw new ForbiddenException(
        'Only approved members can give online.',
      );
    }

    if (dto.pledgeId) {
      const pledge = await this.prisma.pledge.findFirst({
        where: {
          id: dto.pledgeId,
          organizationId,
          churchMember: {
            userId: user.id,
          },
          status: {
            in: ['OPEN', 'PARTIALLY_PAID'],
          },
        },
        select: {
          id: true,
        },
      });

      if (!pledge) {
        throw new BadRequestException(
          'Pledge not found or already closed.',
        );
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
          type: dto.pledgeId
            ? 'PLEDGE'
            : (dto.type ?? 'DONATION'),
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
          email:
            payer.email ??
            `user-${payer.id}@pay.neighborhood.app`,
          amount: decimal.mul(100).toFixed(0),
          currency: payment.currency,
          reference,
          callback_url:
            this.config.get('PAYSTACK_CALLBACK_URL') || undefined,
          metadata: {
            purpose: 'giving',
            organizationId,
          },
        }),
      });

      return {
        reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  /** Runs inside the settle transaction once Paystack confirms a gift. */
  private async recordOnlineGiving(
    tx: Prisma.TransactionClient,
    payment: Payment,
  ) {
    if (!payment.organizationId || !payment.payerId) {
      throw new Error(
        `Giving payment ${payment.id} is missing its organization or payer`,
      );
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
        type: meta.pledgeId
          ? 'PLEDGE'
          : (meta.type ?? 'DONATION'),
        amount: payment.amount,
        currency: payment.currency,
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
          status: {
            in: ['OPEN', 'PARTIALLY_PAID'],
          },
        },
      });

      if (pledge) {
        const paid = pledge.amountPaid.add(payment.amount);

        await tx.pledge.update({
          where: { id: pledge.id },
          data: {
            amountPaid: paid,
            status: paid.gte(pledge.targetAmount)
              ? 'FULFILLED'
              : 'PARTIALLY_PAID',
          },
        });
      }
    }
  }

  /**
   * Verifies with Paystack and settles.
   * Safe to call repeatedly from webhook and app callback.
   */
  async settle(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        providerRef: reference,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === 'SUCCEEDED') {
      return payment;
    }

    const data = await this.paystack<{
      status: string;
      amount: number;
      currency: string;
      channel: string;
      paid_at?: string;
    }>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );

    if (data.status !== 'success') {
      if (
        ['failed', 'abandoned', 'reversed'].includes(data.status) &&
        payment.status === 'PENDING'
      ) {
        return this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
          },
        });
      }

      return payment;
    }

    if (
      String(data.amount) !== payment.amount.mul(100).toFixed(0) ||
      data.currency !== payment.currency
    ) {
      this.log.error(
        `Amount mismatch for ${reference}: got ${data.amount} ${data.currency}, expected ${payment.amount} ${payment.currency}`,
      );

      throw new BadRequestException(
        'Payment amount mismatch',
      );
    }

    let late: string | undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: {
            not: 'SUCCEEDED',
          },
        },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(data.paid_at ?? Date.now()),
          method: CHANNEL_TO_METHOD[data.channel] ?? 'OTHER',
        },
      });

      if (claimed.count === 0) {
        return {
          fresh: false as const,
        };
      }

      let walletBalance: string | undefined;

      // WALLET FUNDING
      if (payment.purpose === 'WALLET_FUNDING') {
        if (!payment.organizationId) {
          throw new Error(
            `Top-up ${payment.id} has no organization`,
          );
        }

        const wallet = await this.wallet.credit(
          tx,
          payment.organizationId,
          payment.amount,
          'TOPUP',
          'Wallet top-up',
          `topup:${payment.id}`,
        );

        walletBalance = wallet.balance.toFixed(2);
      }

      // ONLINE GIVING
      else if (payment.purpose === 'GIVING') {
        await this.recordOnlineGiving(tx, payment);
      }

      // ORDER PAYMENT
      else if (payment.orderId) {
        const r = await this.orders.confirmOrderTx(
          tx,
          payment.orderId,
        );

        if (!r.confirmed) {
          late = String(r.reason);
        }
      }

      return {
        fresh: true as const,
        walletBalance,
      };
    });

    if (result.fresh) {
      // ORDER PAYMENT EMAIL
      if (
        payment.purpose === 'ORDER' &&
        payment.orderId
      ) {
        try {
          await this.orders.notifyPaid(
            payment.orderId,
            late,
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown order notification error';

          this.log.error(
            `Order payment notification failed for ${payment.id}: ${message}`,
          );
        }
      }

      // WALLET TOP-UP / GIVING EMAIL
      if (
        payment.purpose === 'WALLET_FUNDING' ||
        payment.purpose === 'GIVING'
      ) {
        const settledPayment =
          await this.prisma.payment.findUniqueOrThrow({
            where: {
              id: payment.id,
            },
          });

        await this.sendNonOrderPaymentEmail(
          settledPayment,
          result.walletBalance,
        );
      }
    }

    return this.prisma.payment.findUniqueOrThrow({
      where: {
        id: payment.id,
      },
    });
  }

  async status(userId: string, reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        providerRef: reference,
      },
    });

    if (!payment || payment.payerId !== userId) {
      throw new NotFoundException('Payment not found');
    }

    return this.settle(reference);
  }
}
