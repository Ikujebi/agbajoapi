import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [ChatService, ChatGateway],
  controllers: [ChatController],
})
export class ChatModule {}
