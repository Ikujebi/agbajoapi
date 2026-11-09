import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailOutboxStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { serviceBookingTemplate } from '../mail/templates';

export interface ServiceBookingEmailOptions {
  title: string;
  message: string;
  serviceName: string;
  bookingId: string;
  details?: string[];
}

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

  /**
   * Process pending emails every 30 seconds.
   */
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

      this.logger.error(
        `Email outbox processing failed: ${message}`,
      );
    }
  }

  /**
   * Return abandoned PROCESSING records to PENDING.
   */
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

  /**
   * Validate the JSON payload retrieved from PostgreSQL.
   *
   * Prisma.JsonValue is intentionally treated as untrusted data.
   */
  private parseServiceBookingPayload(
    payload: Prisma.JsonValue,
  ): ServiceBookingEmailOptions {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new Error(
        'Invalid service booking email payload.',
      );
    }

    const data = payload as Prisma.JsonObject;

    if (
      typeof data.title !== 'string' ||
      typeof data.message !== 'string' ||
      typeof data.serviceName !== 'string' ||
      typeof data.bookingId !== 'string'
    ) {
      throw new Error(
        'Service booking email payload is missing required fields.',
      );
    }

    if (
      data.details !== undefined &&
      (
        !Array.isArray(data.details) ||
        !data.details.every(
          (detail) => typeof detail === 'string',
        )
      )
    ) {
      throw new Error(
        'Invalid service booking email details.',
      );
    }

    return {
      title: data.title,
      message: data.message,
      serviceName: data.serviceName,
      bookingId: data.bookingId,
      ...(Array.isArray(data.details)
        ? {
            details: data.details as string[],
          }
        : {}),
    };
  }

  /**
   * Atomically claim and process one email.
   */
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

    // Another worker may already have claimed this email.
    if (claim.count !== 1) {
      return;
    }

    const item = await this.prisma.emailOutbox.findUnique({
      where: {
        id,
      },
    });

    if (!item) {
      this.logger.warn(
        `Claimed email outbox record ${id} could not be found.`,
      );
      return;
    }

    try {
      if (item.templateKey !== 'SERVICE_BOOKING') {
        throw new Error(
          `Unsupported email template: ${item.templateKey}`,
        );
      }

      const payload = this.parseServiceBookingPayload(
        item.payload,
      );

      const html = this.templates.render(
        serviceBookingTemplate,
        payload,
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

      this.logger.error(
        `Email outbox ${item.id} failed: ${message}`,
      );

      await this.scheduleRetry(
        item.id,
        item.attempts,
        item.maxAttempts,
        message,
      );
    }
  }

  /**
   * Retry failed emails using exponential backoff.
   *
   * Attempts:
   * 1 = 30 seconds
   * 2 = 60 seconds
   * 3 = 120 seconds
   * 4 = 240 seconds
   * 5 = FAILED (when maxAttempts is 5)
   */
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