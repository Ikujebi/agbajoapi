import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { SendMessageDto, SetPrivacyDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chat: ChatService) {}

  @Get('conversations') list(@CurrentUser() u: AuthUser) { return this.chat.conversations(u.id); }
  @Get('requests') requests(@CurrentUser() u: AuthUser) { return this.chat.conversations(u.id, true); }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('before') before?: string) {
    return this.chat.messages(u.id, id, before);
  }

  // REST fallback; the realtime path is the WebSocket gateway
  @Post('send') send(@CurrentUser() u: AuthUser, @Body() dto: SendMessageDto) {
    return this.chat.send(u.id, dto.recipientId, dto.text);
  }

  @Post('conversations/:id/accept') accept(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.chat.respondToRequest(u.id, id, true); }
  @Post('conversations/:id/decline') decline(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.chat.respondToRequest(u.id, id, false); }

  @Patch('privacy') privacy(@CurrentUser() u: AuthUser, @Body() dto: SetPrivacyDto) { return this.chat.setPrivacy(u.id, dto.chatPrivacy); }

  @Post('block/:userId') block(@CurrentUser() u: AuthUser, @Param('userId') id: string) { return this.chat.block(u.id, id); }
  @Delete('block/:userId') unblock(@CurrentUser() u: AuthUser, @Param('userId') id: string) { return this.chat.unblock(u.id, id); }
}
