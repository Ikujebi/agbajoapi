import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { FcmService } from './fcm.service';

export interface NotifyInput {
  type?: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string | number | null>;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Saves an in-app notification for each user, then pushes to their devices.
   * The database write is awaited. The push runs in the background, so a
   * Firebase outage never breaks the request that triggered it.
   */
  async send(userIds: string[], input: NotifyInput): Promise<void> {
    const ids = [...new Set(userIds)];

    if (ids.length === 0) return;

    const type = input.type ?? 'GENERAL';

    await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type,
        title: input.title,
        body: input.body,
        data: input.data,
      })),
    });

    // Instant delivery to anyone with the app open.
    this.realtime.emitToUsers(ids, 'notification:new', {
      type,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
      createdAt: new Date().toISOString(),
    });

    void this.push(ids, type, input).catch((error: Error) =>
      this.log.error(`Push failed: ${error.message}`),
    );
  }

  private async push(
    userIds: string[],
    type: NotificationType,
    input: NotifyInput,
  ): Promise<void> {
    if (!this.fcm.enabled) return;

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });

    if (devices.length === 0) return;

    const data: Record<string, string> = { type };

    for (const [key, value] of Object.entries(input.data ?? {})) {
      data[key] = value === null ? '' : String(value);
    }

    const dead = await this.fcm.send(
      devices.map((device) => device.token),
      {
        title: input.title,
        body: input.body,
        data,
        highPriority: type === 'SAFETY',
      },
    );

    if (dead.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: dead } },
      });
    }
  }
}