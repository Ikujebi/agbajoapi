import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

/**
 * Client usage (React Native):
 *   const socket = io(`${API_URL}/chat`, { auth: { token: accessToken } });
 *   socket.emit('message:send', { recipientId, text }, (ack) => ...);
 *   socket.on('message:new', ({ message, conversation }) => ...);
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService, private config: ConfigService, private chat: ChatService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') });
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('message:send')
  async onSend(@ConnectedSocket() client: Socket, @MessageBody() body: { recipientId: string; text: string }) {
    try {
      const userId = client.data.userId as string;
      const result = await this.chat.send(userId, body.recipientId, body.text);
      this.server.to(`user:${body.recipientId}`).to(`user:${userId}`).emit('message:new', result);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
