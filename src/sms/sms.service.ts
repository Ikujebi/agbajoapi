import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Sends a plain-text SMS through Termii.
   * `to` is an E.164 number such as +2348031234567.
   *
   * Env: TERMII_API_KEY, TERMII_SENDER_ID, and optionally TERMII_BASE_URL
   * (shown in your Termii dashboard) and TERMII_CHANNEL (generic or dnd).
   */
  async send(to: string, message: string): Promise<void> {
    const apiKey = this.config.get<string>('TERMII_API_KEY');

    if (!apiKey) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error('SMS provider is not configured (TERMII_API_KEY).');
      }

      // Local development: print the message instead of sending it.
      this.log.warn(`[DEV ONLY] SMS to ${to}: ${message}`);
      return;
    }

    const baseUrl =
      this.config.get<string>('TERMII_BASE_URL') ?? 'https://api.ng.termii.com';

    const response = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: to.replace(/^\+/, ''), // Termii wants 234..., without the plus
        from: this.config.getOrThrow<string>('TERMII_SENDER_ID'),
        sms: message,
        type: 'plain',
        channel: this.config.get<string>('TERMII_CHANNEL') ?? 'generic',
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Termii responded ${response.status}: ${detail.slice(0, 200)}`);
    }
  }
}

@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
