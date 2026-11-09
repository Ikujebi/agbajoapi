
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { displayName } from '../common/utils/names';

import {
  ListingExpiredEmailOptions,
  ListingInquiryEmailOptions,
  ServiceBookingEmailOptions,
  NewOrderNotificationOptions,
  OrderConfirmationOptions,
  OrderReceiptOptions,
  OrderStatusOptions,
  PaymentConfirmationOptions,
} from '../mail/templates';

export type ServiceBookingEmailPayload = Omit<
  ServiceBookingEmailOptions,
  'recipientName'
>;

export type ListingInquiryEmailPayload = Omit<
  ListingInquiryEmailOptions,
  'recipientName'
>;

export type ListingExpiredEmailPayload = Omit<
  ListingExpiredEmailOptions,
  'recipientName'
>;

export type NewOrderNotificationEmailPayload = Omit<
  NewOrderNotificationOptions,
  'recipientName'
>;

export type OrderConfirmationEmailPayload = Omit<
  OrderConfirmationOptions,
  'recipientName'
>;

export type OrderReceiptEmailPayload = Omit<
  OrderReceiptOptions,
  'recipientName'
>;

export type OrderStatusEmailPayload = Omit<
  OrderStatusOptions,
  'recipientName'
>;

export type PaymentConfirmationEmailPayload = Omit<
  PaymentConfirmationOptions,
  'recipientName'
>;

interface BaseQueueEmailInput<TPayload extends object> {
  recipientId: string;
  subject: string;
  dedupeKey: string;
  payload: TPayload;
}

export type QueueServiceBookingEmailInput =
  BaseQueueEmailInput<ServiceBookingEmailPayload>;

export type QueueListingInquiryEmailInput =
  BaseQueueEmailInput<ListingInquiryEmailPayload>;

export type QueueListingExpiredEmailInput =
  BaseQueueEmailInput<ListingExpiredEmailPayload>;

export type QueueNewOrderNotificationEmailInput =
  BaseQueueEmailInput<NewOrderNotificationEmailPayload>;

export type QueueOrderConfirmationEmailInput =
  BaseQueueEmailInput<OrderConfirmationEmailPayload>;

export type QueueOrderReceiptEmailInput =
  BaseQueueEmailInput<OrderReceiptEmailPayload>;

export type QueueOrderStatusEmailInput =
  BaseQueueEmailInput<OrderStatusEmailPayload>;

export type QueuePaymentConfirmationEmailInput =
  BaseQueueEmailInput<PaymentConfirmationEmailPayload>;

type EmailTemplateKey =
  | 'SERVICE_BOOKING'
  | 'LISTING_INQUIRY'
  | 'LISTING_EXPIRED'
  | 'NEW_ORDER_NOTIFICATION'
  | 'ORDER_CONFIRMATION'
  | 'ORDER_RECEIPT'
  | 'ORDER_STATUS'
  | 'PAYMENT_CONFIRMATION';

interface EnqueueEmailInput {
  recipientId: string;
  subject: string;
  dedupeKey: string;
  templateKey: EmailTemplateKey;
  payload: object;
}

@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);

  async enqueueServiceBookingEmail(
    tx: Prisma.TransactionClient,
    input: QueueServiceBookingEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'SERVICE_BOOKING',
    });
  }

  async enqueueListingInquiryEmail(
    tx: Prisma.TransactionClient,
    input: QueueListingInquiryEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'LISTING_INQUIRY',
    });
  }

  async enqueueListingExpiredEmail(
    tx: Prisma.TransactionClient,
    input: QueueListingExpiredEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'LISTING_EXPIRED',
    });
  }

  async enqueueNewOrderNotificationEmail(
    tx: Prisma.TransactionClient,
    input: QueueNewOrderNotificationEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'NEW_ORDER_NOTIFICATION',
    });
  }

  async enqueueOrderConfirmationEmail(
    tx: Prisma.TransactionClient,
    input: QueueOrderConfirmationEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'ORDER_CONFIRMATION',
    });
  }

  async enqueueOrderReceiptEmail(
    tx: Prisma.TransactionClient,
    input: QueueOrderReceiptEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'ORDER_RECEIPT',
    });
  }

  async enqueueOrderStatusEmail(
    tx: Prisma.TransactionClient,
    input: QueueOrderStatusEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'ORDER_STATUS',
    });
  }

  async enqueuePaymentConfirmationEmail(
    tx: Prisma.TransactionClient,
    input: QueuePaymentConfirmationEmailInput,
  ): Promise<void> {
    await this.enqueue(tx, {
      ...input,
      templateKey: 'PAYMENT_CONFIRMATION',
    });
  }

  private async enqueue(
    tx: Prisma.TransactionClient,
    input: EnqueueEmailInput,
  ): Promise<void> {
    const recipient = await tx.user.findUnique({
      where: {
        id: input.recipientId,
      },
      select: {
        email: true,
        firstName: true,
        otherNames: true,
        lastName: true,
      },
    });

    if (!recipient?.email) {
      this.logger.warn(
        `Email skipped: recipient ${input.recipientId} has no email address.`,
      );
      return;
    }

    const payload = {
      ...input.payload,
      recipientName: displayName(recipient),
    };

    await tx.emailOutbox.upsert({
      where: {
        dedupeKey: input.dedupeKey,
      },
      create: {
        dedupeKey: input.dedupeKey,
        recipientEmail: recipient.email,
        subject: input.subject,
        templateKey: input.templateKey,
        payload: payload as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}
