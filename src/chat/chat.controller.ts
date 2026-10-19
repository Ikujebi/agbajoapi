
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SendMessageDto, SetPrivacyDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.chat.conversations(user.id);
  }

  @Get('requests')
  requests(@CurrentUser() user: AuthUser) {
    return this.chat.conversations(user.id, true);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.chat.messages(user.id, id, cursor);
  }

  @Post('send')
  async send(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
  ) {
    const result = await this.chat.send(
      user.id,
      dto.recipientId,
      dto.text,
    );

    this.gateway.publishMessage(
      user.id,
      dto.recipientId,
      result,
    );

    return result;
  }

  @Post('conversations/:id/accept')
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const conversation = await this.chat.respondToRequest(
      user.id,
      id,
      true,
    );

    this.gateway.publishConversationUpdate(
      conversation.userAId,
      conversation.userBId,
      conversation,
    );

    return conversation;
  }

  @Post('conversations/:id/decline')
  async decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const conversation = await this.chat.respondToRequest(
      user.id,
      id,
      false,
    );

    this.gateway.publishConversationUpdate(
      conversation.userAId,
      conversation.userBId,
      conversation,
    );

    return conversation;
  }

  @Post('conversations/:id/read')
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.chat.markRead(user.id, id);
    const participants = await this.chat.getConversationParticipants(
      user.id,
      id,
    );

    this.gateway.publishReadReceipt(
      participants.otherUserId,
      result,
    );

    return result;
  }

  @Patch('privacy')
  privacy(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetPrivacyDto,
  ) {
    return this.chat.setPrivacy(user.id, dto.chatPrivacy);
  }

  @Post('block/:userId')
  block(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) blockedId: string,
  ) {
    return this.chat.block(user.id, blockedId);
  }

  @Delete('block/:userId')
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) blockedId: string,
  ) {
    return this.chat.unblock(user.id, blockedId);
  }
}
