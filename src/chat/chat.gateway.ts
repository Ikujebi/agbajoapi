
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
  };
}

interface AccessTokenPayload {
  sub?: string;
}

const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly messageTimes = new Map<string, number[]>();
  private readonly maxMessagesPerMinute = 20;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chat: ChatService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token: unknown = client.handshake.auth?.token;

      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('Missing access token');
      }

      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      if (typeof payload.sub !== 'string' || !payload.sub) {
        throw new Error('Invalid token subject');
      }

      // Prevent inactive or deleted accounts from opening a chat socket.
      await this.chat.assertSocketUserActive(payload.sub);

      client.data.userId = payload.sub;
      await client.join(this.userRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    const userId = client.data.userId;
    if (!userId || !this.server) return;

    const hasOtherSockets = [...this.server.sockets.sockets.values()].some(
      (socket) =>
        (socket as AuthenticatedSocket).data.userId === userId,
    );

    if (!hasOtherSockets) {
      this.messageTimes.delete(userId);
    }
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private requireUser(client: AuthenticatedSocket): string {
    const userId = client.data.userId;

    if (!userId) {
      throw new WsException('Authentication required');
    }

    return userId;
  }

  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const cutoff = now - 60_000;

    const recent = (this.messageTimes.get(userId) ?? []).filter(
      (time) => time > cutoff,
    );

    if (recent.length >= this.maxMessagesPerMinute) {
      this.messageTimes.set(userId, recent);
      throw new WsException('Too many messages. Please try again shortly.');
    }

    recent.push(now);
    this.messageTimes.set(userId, recent);
  }

  private errorResponse(error: unknown) {
    if (error instanceof WsException) {
      const response = error.getError();

      return {
        ok: false,
        error:
          typeof response === 'string'
            ? response
            : 'Invalid WebSocket request',
      };
    }

    // Nest HTTP exceptions thrown by the shared service can safely return
    // their client-facing message. Never return arbitrary internal errors.
    if (
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof error.getStatus === 'function' &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      const status = error.getStatus();

      if (status >= 400 && status < 500) {
        return { ok: false, error: error.message };
      }
    }

    return { ok: false, error: 'Unable to process chat request' };
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: SendMessageDto,
  ) {
    try {
      const senderId = this.requireUser(client);
      this.checkRateLimit(senderId);

      const result = await this.chat.send(
        senderId,
        body.recipientId,
        body.text,
      );

      this.publishMessage(senderId, body.recipientId, result);

      return { ok: true, ...result };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  @SubscribeMessage('conversation:request:respond')
  async onRespondToRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    body: { conversationId: string; accept: boolean },
  ) {
    try {
      const userId = this.requireUser(client);

      if (
        !body ||
        typeof body.conversationId !== 'string' ||
        typeof body.accept !== 'boolean'
      ) {
        throw new WsException('Invalid request payload');
      }

      const conversation = await this.chat.respondToRequest(
        userId,
        body.conversationId,
        body.accept,
      );

      this.publishConversationUpdate(
        conversation.userAId,
        conversation.userBId,
        conversation,
      );

      return { ok: true, conversation };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  @SubscribeMessage('conversation:read')
  async onRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { conversationId: string },
  ) {
    try {
      const userId = this.requireUser(client);

      if (!body || typeof body.conversationId !== 'string') {
        throw new WsException('Invalid conversation ID');
      }

      const result = await this.chat.markRead(
        userId,
        body.conversationId,
      );

      const participants = await this.chat.getConversationParticipants(
        userId,
        body.conversationId,
      );

      this.server
        .to(this.userRoom(participants.otherUserId))
        .emit('message:read', result);

      return { ok: true, ...result };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  publishMessage(
    senderId: string,
    recipientId: string,
    payload: unknown,
  ): void {
    this.server
      .to(this.userRoom(senderId))
      .to(this.userRoom(recipientId))
      .emit('message:new', payload);
  }

  publishConversationUpdate(
    userAId: string,
    userBId: string,
    conversation: unknown,
  ): void {
    this.server
      .to(this.userRoom(userAId))
      .to(this.userRoom(userBId))
      .emit('conversation:updated', { conversation });
  }

  publishReadReceipt(
    recipientId: string,
    payload: unknown,
  ): void {
    this.server
      .to(this.userRoom(recipientId))
      .emit('message:read', payload);
  }
}
