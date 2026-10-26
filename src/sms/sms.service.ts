
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Sends a plain-text SMS through Termii.
   * `to` is an E.164 number such as +2348031234567.
   *
   * Environment variables:
   * TERMII_API_KEY, TERMII_SENDER_ID,
   * optionally TERMII_BASE_URL and TERMII_CHANNEL.
   */
  async send(to: string, message: string): Promise<void> {
    const apiKey = this.config.get<string>('TERMII_API_KEY');

    if (!apiKey) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error(
          'SMS provider is not configured (TERMII_API_KEY).',
        );
      }

      this.log.warn(`[DEV ONLY] SMS to ${to}: ${message}`);
      return;
    }

    const baseUrl = (
      this.config.get<string>('TERMII_BASE_URL') ??
      'https://api.ng.termii.com'
    ).replace(/\/+$/, '');

    const senderId =
      this.config.get<string>('TERMII_SENDER_ID');

    if (!senderId) {
      throw new Error(
        'SMS provider is not configured (TERMII_SENDER_ID).',
      );
    }

    const response = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: to.replace(/^\+/, ''),
        from: senderId,
        sms: message,
        type: 'plain',
        channel:
          this.config.get<string>('TERMII_CHANNEL') ?? 'generic',
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Termii responded ${response.status}: ${detail.slice(0, 200)}`,
      );
    }
  }
}
