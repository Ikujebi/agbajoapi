import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.from = config.get<string>('MAIL_FROM') || 'no-reply@example.com';
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(config.get('SMTP_PORT') || 587),
        auth: { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') },
      });
    } else {
      this.logger.warn('SMTP not configured - emails will be logged instead of sent');
    }
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.log(`[EMAIL to ${to}] ${subject}`);
      return true;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      return true;
    } catch (e) {
      this.logger.error(`Email to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }

  // Simple sequential bulk send. Move to a BullMQ queue when volume grows.
  async sendBulk(recipients: string[], subject: string, html: string) {
    let sent = 0;
    for (const to of recipients) {
      if (await this.send(to, subject, html)) sent++;
    }
    return sent;
  }
}
