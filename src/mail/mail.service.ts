
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import {
  MAIL_CONFIG_KEYS,
  MAIL_DELIVERY_DEFAULTS,
} from './mail.constants';

import type { MailSendOptions } from './mail.types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  private readonly resend: Resend | null;
  private readonly from: string | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config
      .get<string>(MAIL_CONFIG_KEYS.API_KEY)
      ?.trim();

    const from = (
      this.config.get<string>(MAIL_CONFIG_KEYS.FROM_EMAIL) ||
      this.config.get<string>(MAIL_CONFIG_KEYS.FALLBACK_FROM_EMAIL) ||
      ''
    ).trim();

    this.from = from || null;
    this.resend = apiKey ? new Resend(apiKey) : null;

    if (!this.resend || !this.from) {
      this.logger.warn(
        'Email service is disabled: Resend configuration is incomplete.',
      );
      return;
    }

    this.logger.log('Email service initialized successfully.');
  }

  /**
   * Checks whether an email address is structurally valid.
   */
  private isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email.trim());
  }

  /**
   * Validates the required email fields.
   */
  private isValidPayload(
    to: string,
    subject: string,
    html: string,
  ): boolean {
    if (!this.isValidEmail(to)) {
      this.logger.warn('Email rejected: Invalid recipient address.');
      return false;
    }

    if (
      typeof subject !== 'string' ||
      !subject.trim() ||
      /[\r\n]/.test(subject)
    ) {
      this.logger.warn('Email rejected: Invalid subject.');
      return false;
    }

    if (typeof html !== 'string' || !html.trim()) {
      this.logger.warn('Email rejected: Empty HTML content.');
      return false;
    }

    return true;
  }

  /**
   * Sends one email.
   *
   * Returns true when Resend accepts the request.
   * This does not guarantee final delivery.
   */
  async send(
    to: string,
    subject: string,
    html: string,
    options?: MailSendOptions,
  ): Promise<boolean> {
    if (!this.resend || !this.from) {
      this.logger.error(
        'Email sending unavailable: Service not configured.',
      );
      return false;
    }

    if (
      typeof to !== 'string' ||
      !this.isValidPayload(to, subject, html)
    ) {
      return false;
    }

    const recipient = to.trim().toLowerCase();

    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: this.from,
          to: recipient,
          subject: subject.trim(),
          html,
        },
        options?.idempotencyKey
          ? {
              idempotencyKey: options.idempotencyKey,
            }
          : undefined,
      );

      if (error) {
        this.logger.error(
          `Email provider rejected request: ${error.name} - ${error.message}`,
        );

        return false;
      }

      if (!data?.id) {
        this.logger.warn(
          'Email provider returned no email ID after submission.',
        );

        return false;
      }

      this.logger.log(
        `Email accepted by Resend. Email ID: ${data.id}`,
      );

      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Email sending failed: ${message}`);

      return false;
    }
  }

  /**
   * Sends bulk emails using Resend's batch endpoint.
   *
   * Features:
   * - Normalizes recipient addresses.
   * - Removes duplicate addresses.
   * - Excludes invalid addresses.
   * - Processes at most 100 emails per batch.
   * - Continues with subsequent batches after a failed batch.
   * - Supports stable idempotency keys for retries.
   *
   * Returns the number of emails accepted by Resend.
   */
  async sendBulk(
    recipients: string[],
    subject: string,
    html: string,
    batchId?: string,
  ): Promise<number> {
    if (!this.resend || !this.from) {
      this.logger.error(
        'Bulk email unavailable: Service not configured.',
      );

      return 0;
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      this.logger.warn('Bulk email skipped: No recipients provided.');
      return 0;
    }

    if (
      typeof subject !== 'string' ||
      !subject.trim() ||
      /[\r\n]/.test(subject) ||
      typeof html !== 'string' ||
      !html.trim()
    ) {
      this.logger.warn(
        'Bulk email rejected: Invalid email content.',
      );

      return 0;
    }

    // Normalize addresses and remove duplicates.
    const uniqueRecipients = [
      ...new Set(
        recipients
          .filter(
            (email): email is string =>
              typeof email === 'string',
          )
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];

    // Separate valid and invalid addresses.
    const validRecipients = uniqueRecipients.filter((email) =>
      this.isValidEmail(email),
    );

    const invalidCount =
      uniqueRecipients.length - validRecipients.length;

    if (invalidCount > 0) {
      this.logger.warn(
        `Bulk email: ${invalidCount} invalid recipient(s) excluded.`,
      );
    }

    if (validRecipients.length === 0) {
      this.logger.warn(
        'Bulk email skipped: No valid recipients.',
      );

      return 0;
    }

    let accepted = 0;
    let failed = 0;

    const batchSize =
      MAIL_DELIVERY_DEFAULTS.BULK_BATCH_SIZE;

    const totalBatches = Math.ceil(
      validRecipients.length / batchSize,
    );

    // Process each batch independently.
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;

      const batch = validRecipients.slice(
        start,
        start + batchSize,
      );

      try {
        const emails = batch.map((to) => ({
          from: this.from!,
          to,
          subject: subject.trim(),
          html,
        }));

        const { data, error } = await this.resend.batch.send(
          emails,
          batchId
            ? {
                idempotencyKey: `bulk-email/${batchId}/chunk-${i}`,
              }
            : undefined,
        );

        if (error) {
          failed += batch.length;

          this.logger.error(
            `Bulk email batch ${i + 1}/${totalBatches} failed: ${error.message}`,
          );

          continue;
        }

        // Count records accepted by the provider.
        const batchAccepted = Math.min(
          data?.length ?? 0,
          batch.length,
        );

        accepted += batchAccepted;
        failed += batch.length - batchAccepted;

        this.logger.log(
          `Bulk email batch ${i + 1}/${totalBatches}: ` +
            `${batchAccepted}/${batch.length} accepted.`,
        );
      } catch (error: unknown) {
        failed += batch.length;

        const message =
          error instanceof Error
            ? error.message
            : 'Unknown error';

        this.logger.error(
          `Bulk email batch ${i + 1}/${totalBatches} failed: ${message}`,
        );
      }
    }

    this.logger.log(
      `Bulk email completed. Accepted: ${accepted}, ` +
        `Failed: ${failed}, Total: ${validRecipients.length}.`,
    );

    return accepted;
  }
}
