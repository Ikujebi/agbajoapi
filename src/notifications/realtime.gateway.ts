import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { PrismaService } from '../prisma/prisma.service';
import { socketCorsOrigin } from '../common/utils/socket-cors';

interface RealtimeSocket extends Socket {
  data: { userId?: string };
}

/**
 * One-way channel from the server to a user's devices.
 * Clients connect to the /realtime namespace with { auth: { token } } and
 * listen for events such as "notification:new". Other services push through
 * emitToUsers().
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: socketCorsOrigin, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: RealtimeSocket): Promise<void> {
    try {
      const token: unknown = client.handshake.auth?.token;

      if (typeof token !== 'string' || !token) {
        throw new Error('Missing access token');
      }

      const payload = await this.jwt.verifyAsync<{ sub?: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      if (typeof payload.sub !== 'string' || !payload.sub) {
        throw new Error('Invalid token subject');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true },
      });

      if (!user?.isActive) {
        throw new Error('Inactive user');
      }

      client.data.userId = payload.sub;
      await client.join(this.room(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  private room(userId: string): string {
    return `user:${userId}`;
  }

  /** Delivers an event to every connected device of each user. */
  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.server || userIds.length === 0) return;

    this.server.to(userIds.map((id) => this.room(id))).emit(event, payload);
  }
}

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
