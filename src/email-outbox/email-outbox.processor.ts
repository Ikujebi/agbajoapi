
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailOutboxStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';

import {
  listingExpiredTemplate,
  listingInquiryTemplate,
  serviceBookingTemplate,
  newOrderNotificationTemplate,
  orderConfirmationTemplate,
  orderReceiptTemplate,
  orderStatusTemplate,
  paymentConfirmationTemplate,
  ListingExpiredEmailOptions,
  ListingInquiryEmailOptions,
  ServiceBookingEmailOptions,
  NewOrderNotificationOptions,
  OrderConfirmationOptions,
  OrderReceiptOptions,
  OrderStatusOptions,
  PaymentConfirmationOptions,
} from '../mail/templates';

@Injectable()
export class EmailOutboxProcessor {
  private readonly logger = new Logger(EmailOutboxProcessor.name);

  private readonly batchSize = 25;
  private readonly lockTimeoutMs = 10 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly templates: MailTemplatesService,
  ) {}

  @Cron('*/30 * * * * *')
  async processPendingEmails(): Promise<void> {
    try {
      await this.releaseStaleLocks();

      const pending = await this.prisma.emailOutbox.findMany({
        where: {
          status: EmailOutboxStatus.PENDING,
          nextAttemptAt: {
            lte: new Date(),
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: this.batchSize,
        select: {
          id: true,
        },
      });

      for (const item of pending) {
        await this.processOne(item.id);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown email processor error.';

      this.logger.error(`Email outbox processing failed: ${message}`);
    }
  }

  private async releaseStaleLocks(): Promise<void> {
    const staleBefore = new Date(
      Date.now() - this.lockTimeoutMs,
    );

    await this.prisma.emailOutbox.updateMany({
      where: {
        status: EmailOutboxStatus.PROCESSING,
        lockedAt: {
          lt: staleBefore,
        },
      },
      data: {
        status: EmailOutboxStatus.PENDING,
        lockedAt: null,
        nextAttemptAt: new Date(),
        lastError: 'Processing lease expired.',
      },
    });
  }

  private getPayloadObject(
    payload: Prisma.JsonValue,
  ): Prisma.JsonObject {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new Error('Invalid email payload: expected an object.');
    }

    return payload as Prisma.JsonObject;
  }

  private requiredString(
    data: Prisma.JsonObject,
    key: string,
  ): string {
    const value = data[key];

    if (typeof value !== 'string') {
      throw new Error(
        `Invalid email payload: "${key}" must be a string.`,
      );
    }

    return value;
  }

  private optionalString(
    data: Prisma.JsonObject,
    key: string,
  ): string | undefined {
    const value = data[key];

    if (value === undefined) return undefined;

    if (typeof value !== 'string') {
      throw new Error(
        `Invalid email payload: "${key}" must be a string when provided.`,
      );
    }

    return value;
  }

  private optionalNumber(
    data: Prisma.JsonObject,
    key: string,
  ): number | undefined {
    const value = data[key];

    if (value === undefined) return undefined;

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `Invalid email payload: "${key}" must be a number when provided.`,
      );
    }

    return value;
  }

  private optionalStringArray(
    data: Prisma.JsonObject,
    key: string,
  ): string[] | undefined {
    const value = data[key];

    if (value === undefined) return undefined;

    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string')
    ) {
      throw new Error(
        `Invalid email payload: "${key}" must be an array of strings.`,
      );
    }

    return value as string[];
  }

  private requiredArray(
    data: Prisma.JsonObject,
    key: string,
  ): Prisma.JsonArray {
    const value = data[key];

    if (!Array.isArray(value)) {
      throw new Error(
        `Invalid email payload: "${key}" must be an array.`,
      );
    }

    return value;
  }

  private parseServiceBookingPayload(
    payload: Prisma.JsonValue,
  ): ServiceBookingEmailOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      title: this.requiredString(data, 'title'),
      message: this.requiredString(data, 'message'),
      serviceName: this.requiredString(data, 'serviceName'),
      bookingId: this.requiredString(data, 'bookingId'),
      details: this.optionalStringArray(data, 'details'),
    };
  }

  private parseListingInquiryPayload(
    payload: Prisma.JsonValue,
  ): ListingInquiryEmailOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      listingTitle: this.requiredString(data, 'listingTitle'),
      buyerName: this.optionalString(data, 'buyerName'),
      message: this.requiredString(data, 'message'),
    };
  }

  private parseListingExpiredPayload(
    payload: Prisma.JsonValue,
  ): ListingExpiredEmailOptions {
    const data = this.getPayloadObject(payload);
    const expiredCount = data.expiredCount;

    if (
      typeof expiredCount !== 'number' ||
      !Number.isInteger(expiredCount) ||
      expiredCount < 0
    ) {
      throw new Error(
        'Invalid listing expiry payload: "expiredCount" must be a non-negative integer.',
      );
    }

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      expiredCount,
      listingTitles: this.optionalStringArray(
        data,
        'listingTitles',
      ),
    };
  }

  private parseNewOrderNotificationPayload(
    payload: Prisma.JsonValue,
  ): NewOrderNotificationOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      customerName: this.requiredString(data, 'customerName'),
      customerEmail: this.optionalString(data, 'customerEmail'),
      customerPhone: this.optionalString(data, 'customerPhone'),
      shopName: this.requiredString(data, 'shopName'),
      orderNumber: this.requiredString(data, 'orderNumber'),
      items: this.parseNewOrderItems(data),
      subtotal: this.optionalString(data, 'subtotal'),
      deliveryFee: this.optionalString(data, 'deliveryFee'),
      discount: this.optionalString(data, 'discount'),
      total: this.requiredString(data, 'total'),
      fulfillmentType: this.parseFulfillmentType(data),
      deliveryAddress: this.optionalString(data, 'deliveryAddress'),
      customerNote: this.optionalString(data, 'customerNote'),
      orderUrl: this.optionalString(data, 'orderUrl'),
      footerText: this.optionalString(data, 'footerText'),
    };
  }

  private parseNewOrderItems(
    data: Prisma.JsonObject,
  ): NewOrderNotificationOptions['items'] {
    return this.requiredArray(data, 'items').map((item) => {
      const row = this.asObject(item);

      return {
        name: this.requiredString(row, 'name'),
        quantity: this.requiredInteger(row, 'quantity'),
        unitPrice: this.optionalString(row, 'unitPrice'),
        total: this.optionalString(row, 'total'),
      };
    });
  }

  private parseOrderConfirmationPayload(
    payload: Prisma.JsonValue,
  ): OrderConfirmationOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      shopName: this.requiredString(data, 'shopName'),
      orderNumber: this.requiredString(data, 'orderNumber'),
      items: this.requiredArray(data, 'items').map((item) => {
        const row = this.asObject(item);

        return {
          name: this.requiredString(row, 'name'),
          quantity: this.requiredInteger(row, 'quantity'),
        };
      }),
      total: this.requiredString(data, 'total'),
      fulfillmentType: this.parseFulfillmentType(data),
      estimatedFulfillment: this.optionalString(
        data,
        'estimatedFulfillment',
      ),
      orderUrl: this.optionalString(data, 'orderUrl'),
      footerText: this.optionalString(data, 'footerText'),
    };
  }

  private parseOrderReceiptPayload(
    payload: Prisma.JsonValue,
  ): OrderReceiptOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      shopName: this.requiredString(data, 'shopName'),
      orderNumber: this.requiredString(data, 'orderNumber'),
      receiptReference: this.optionalString(data, 'receiptReference'),
      issuedAt: this.optionalString(data, 'issuedAt'),
      items: this.requiredArray(data, 'items').map((item) => {
        const row = this.asObject(item);

        return {
          name: this.requiredString(row, 'name'),
          quantity: this.requiredInteger(row, 'quantity'),
          unitPrice: this.requiredString(row, 'unitPrice'),
          lineTotal: this.requiredString(row, 'lineTotal'),
        };
      }),
      subtotal: this.requiredString(data, 'subtotal'),
      deliveryFee: this.optionalString(data, 'deliveryFee'),
      discount: this.optionalString(data, 'discount'),
      tax: this.optionalString(data, 'tax'),
      total: this.requiredString(data, 'total'),
      paymentMethod: this.optionalString(data, 'paymentMethod'),
      paymentStatus: this.optionalString(data, 'paymentStatus'),
      fulfillmentType: this.parseFulfillmentType(data),
      deliveryAddress: this.optionalString(data, 'deliveryAddress'),
      orderUrl: this.optionalString(data, 'orderUrl'),
      footerText: this.optionalString(data, 'footerText'),
    };
  }

  private parseOrderStatusPayload(
    payload: Prisma.JsonValue,
  ): OrderStatusOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      shopName: this.requiredString(data, 'shopName'),
      orderNumber: this.requiredString(data, 'orderNumber'),
      status: this.requiredString(data, 'status'),
      statusLabel: this.requiredString(data, 'statusLabel'),
      message: this.requiredString(data, 'message'),
      updatedAt: this.optionalString(data, 'updatedAt'),
      nextStep: this.optionalString(data, 'nextStep'),
      orderUrl: this.optionalString(data, 'orderUrl'),
      supportEmail: this.optionalString(data, 'supportEmail'),
      footerText: this.optionalString(data, 'footerText'),
    };
  }

  private parsePaymentConfirmationPayload(
    payload: Prisma.JsonValue,
  ): PaymentConfirmationOptions {
    const data = this.getPayloadObject(payload);

    return {
      recipientName: this.optionalString(data, 'recipientName'),
      shopName: this.requiredString(data, 'shopName'),
      orderNumber: this.requiredString(data, 'orderNumber'),
      paymentReference: this.requiredString(data, 'paymentReference'),
      amountPaid: this.requiredString(data, 'amountPaid'),
      currency: this.optionalString(data, 'currency'),
      paymentMethod: this.optionalString(data, 'paymentMethod'),
      paidAt: this.optionalString(data, 'paidAt'),
      transactionReference: this.optionalString(
        data,
        'transactionReference',
      ),
      orderUrl: this.optionalString(data, 'orderUrl'),
      footerText: this.optionalString(data, 'footerText'),
    };
  }

  private asObject(value: Prisma.JsonValue): Prisma.JsonObject {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new Error('Invalid email item: expected an object.');
    }

    return value as Prisma.JsonObject;
  }

  private requiredInteger(
    data: Prisma.JsonObject,
    key: string,
  ): number {
    const value = data[key];

    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `Invalid email payload: "${key}" must be a non-negative integer.`,
      );
    }

    return value;
  }

  private parseFulfillmentType(
    data: Prisma.JsonObject,
  ): 'PICKUP' | 'DELIVERY' | undefined {
    const value = data.fulfillmentType;

    if (value === undefined) return undefined;

    if (value !== 'PICKUP' && value !== 'DELIVERY') {
      throw new Error(
        'Invalid email payload: fulfillmentType must be PICKUP or DELIVERY.',
      );
    }

    return value;
  }

  private renderEmail(
    templateKey: string,
    payload: Prisma.JsonValue,
  ): string {
    switch (templateKey) {
      case 'SERVICE_BOOKING':
        return this.templates.render(
          serviceBookingTemplate,
          this.parseServiceBookingPayload(payload),
        );

      case 'LISTING_INQUIRY':
        return this.templates.render(
          listingInquiryTemplate,
          this.parseListingInquiryPayload(payload),
        );

      case 'LISTING_EXPIRED':
        return this.templates.render(
          listingExpiredTemplate,
          this.parseListingExpiredPayload(payload),
        );

      case 'NEW_ORDER_NOTIFICATION':
        return this.templates.render(
          newOrderNotificationTemplate,
          this.parseNewOrderNotificationPayload(payload),
        );

      case 'ORDER_CONFIRMATION':
        return this.templates.render(
          orderConfirmationTemplate,
          this.parseOrderConfirmationPayload(payload),
        );

      case 'ORDER_RECEIPT':
        return this.templates.render(
          orderReceiptTemplate,
          this.parseOrderReceiptPayload(payload),
        );

      case 'ORDER_STATUS':
        return this.templates.render(
          orderStatusTemplate,
          this.parseOrderStatusPayload(payload),
        );

      case 'PAYMENT_CONFIRMATION':
        return this.templates.render(
          paymentConfirmationTemplate,
          this.parsePaymentConfirmationPayload(payload),
        );

      default:
        throw new Error(
          `Unsupported email template: ${templateKey}`,
        );
    }
  }

  private async processOne(id: string): Promise<void> {
    const now = new Date();

    const claim = await this.prisma.emailOutbox.updateMany({
      where: {
        id,
        status: EmailOutboxStatus.PENDING,
        nextAttemptAt: {
          lte: now,
        },
      },
      data: {
        status: EmailOutboxStatus.PROCESSING,
        lockedAt: now,
        attempts: {
          increment: 1,
        },
      },
    });

    if (claim.count !== 1) return;

    try {
      const item = await this.prisma.emailOutbox.findUnique({
        where: { id },
      });

      if (!item) {
        throw new Error(
          `Claimed email outbox record ${id} could not be found.`,
        );
      }

      const html = this.renderEmail(
        item.templateKey,
        item.payload,
      );

      const accepted = await this.mail.send(
        item.recipientEmail,
        item.subject,
        html,
        {
          idempotencyKey: `email-outbox/${item.id}`,
        },
      );

      if (!accepted) {
        await this.scheduleRetry(
          item.id,
          item.attempts,
          item.maxAttempts,
          'Mail provider did not accept the email.',
        );
        return;
      }

      await this.prisma.emailOutbox.updateMany({
        where: {
          id: item.id,
          status: EmailOutboxStatus.PROCESSING,
        },
        data: {
          status: EmailOutboxStatus.SENT,
          sentAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });

      this.logger.log(
        `Email outbox ${item.id} was accepted by the mail provider.`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown email processing error.';

      this.logger.error(`Email outbox ${id} failed: ${message}`);

      const current = await this.prisma.emailOutbox.findUnique({
        where: { id },
        select: {
          attempts: true,
          maxAttempts: true,
          status: true,
        },
      });

      if (
        current &&
        current.status === EmailOutboxStatus.PROCESSING
      ) {
        await this.scheduleRetry(
          id,
          current.attempts,
          current.maxAttempts,
          message,
        );
      }
    }
  }

  private async scheduleRetry(
    id: string,
    attempts: number,
    maxAttempts: number,
    error: string,
  ): Promise<void> {
    const permanentlyFailed = attempts >= maxAttempts;

    const delayMs = Math.min(
      30_000 * 2 ** Math.max(0, attempts - 1),
      60 * 60 * 1000,
    );

    await this.prisma.emailOutbox.updateMany({
      where: {
        id,
        status: EmailOutboxStatus.PROCESSING,
      },
      data: {
        status: permanentlyFailed
          ? EmailOutboxStatus.FAILED
          : EmailOutboxStatus.PENDING,
        lockedAt: null,
        nextAttemptAt: permanentlyFailed
          ? new Date()
          : new Date(Date.now() + delayMs),
        lastError: error.slice(0, 2000),
      },
    });

    if (permanentlyFailed) {
      this.logger.error(
        `Email outbox ${id} permanently failed after ${attempts} attempts.`,
      );
    } else {
      this.logger.warn(
        `Email outbox ${id} will retry after ${Math.round(delayMs / 1000)} seconds. Attempt ${attempts}/${maxAttempts}.`,
      );
    }
  }
}
