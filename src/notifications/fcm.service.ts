import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

export interface PushPayload {
  title: string;
  body: string;
  /** FCM requires every value to be a string. */
  data?: Record<string, string>;
  /** Wakes sleeping phones faster. Used for safety alerts. */
  highPriority?: boolean;
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class FcmService {
  private readonly log = new Logger(FcmService.name);
  private messaging: Messaging | null = null;

  constructor(config: ConfigService) {
    const encoded = config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');

    if (!encoded) {
      this.log.warn(
        'FIREBASE_SERVICE_ACCOUNT_BASE64 is not set. Push notifications are disabled.',
      );
      return;
    }

    try {
      const credentials = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf8'),
      );
      const app =
        getApps()[0] ?? initializeApp({ credential: cert(credentials) });

      this.messaging = getMessaging(app);
    } catch (error) {
      this.log.error(
        `Firebase credentials are invalid: ${(error as Error).message}`,
      );
    }
  }

  get enabled(): boolean {
    return this.messaging !== null;
  }

  /**
   * Sends one payload to many device tokens.
   * Returns the tokens FCM says are dead, so the caller can delete them.
   */
  async send(tokens: string[], payload: PushPayload): Promise<string[]> {
    if (!this.messaging || tokens.length === 0) return [];

    const dead: string[] = [];

    // FCM accepts at most 500 tokens per multicast call.
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);

      const result = await this.messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: payload.highPriority ? 'high' : 'normal' },
        apns: {
          headers: { 'apns-priority': payload.highPriority ? '10' : '5' },
        },
      });

      result.responses.forEach((response, index) => {
        const code = response.error?.code;

        if (!response.success && code && DEAD_TOKEN_CODES.has(code)) {
          dead.push(batch[index]);
        }
      });
    }

    return dead;
  }
}
