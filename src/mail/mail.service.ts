
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string | undefined;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();

    this.from =
      this.config.get<string>('RESEND_FROM')?.trim() ||
      this.config.get<string>('MAIL_FROM')?.trim();

    this.resend = apiKey ? new Resend(apiKey) : null;

    if (!this.resend) {
      this.logger.warn(
        'RESEND_API_KEY is not configured. Email sending is disabled.',
      );
    }

    if (!this.from) {
      this.logger.warn(
        'RESEND_FROM is not configured. Email sending is disabled.',
      );
    }
  }

  async send(
    to: string,
    subject: string,
    html: string,
  ): Promise<boolean> {
    if (!this.resend || !this.from) {
      this.logger.error(
        `Email not sent to ${to}: Resend API key or sender address is missing.`,
      );
      return false;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(
          `Email to ${to} failed: ${error.message}`,
        );
        return false;
      }

      this.logger.log(
        `Email accepted by Resend for ${to}. ID: ${data?.id ?? 'unknown'}`,
      );

      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown email error';

      this.logger.error(`Email to ${to} failed: ${message}`);
      return false;
    }
  }

  /**
   * Sends one email per recipient.
   * Returns the number of emails accepted by Resend.
   */
  async sendBulk(
    recipients: string[],
    subject: string,
    html: string,
  ): Promise<number> {
    let sent = 0;

    for (const to of recipients) {
      if (await this.send(to, subject, html)) {
        sent++;
      }
    }

    this.logger.log(
      `Bulk email completed: ${sent}/${recipients.length} accepted by Resend.`,
    );

    return sent;
  }
}
