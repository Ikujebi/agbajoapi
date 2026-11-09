import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { displayName } from '../common/utils/names';
import { serviceBookingTemplate } from '../mail/templates';

export type ServiceBookingEmailPayload = Omit<
  Parameters<typeof serviceBookingTemplate>[0],
  'recipientName'
>;

export interface QueueServiceBookingEmailInput {
  recipientId: string;
  subject: string;
  dedupeKey: string;
  payload: ServiceBookingEmailPayload;
}

@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);

  async enqueueServiceBookingEmail(
    tx: Prisma.TransactionClient,
    input: QueueServiceBookingEmailInput,
  ): Promise<void> {
    const recipient = await tx.user.findUnique({
      where: { id: input.recipientId },
      select: {
        email: true,
        firstName: true,
        otherNames: true,
        lastName: true,
      },
    });

    if (!recipient?.email) {
      this.logger.warn(
        `Booking email skipped: recipient ${input.recipientId} has no email address.`,
      );
      return;
    }

    const payload = {
      ...input.payload,
      recipientName: displayName(recipient),
    };

    await tx.emailOutbox.create({
      data: {
        dedupeKey: input.dedupeKey,
        recipientEmail: recipient.email,
        subject: input.subject,
        templateKey: 'SERVICE_BOOKING',
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
}