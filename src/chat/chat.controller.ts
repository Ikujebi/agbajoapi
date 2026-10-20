
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MessageType } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { CloudinaryService } from './../cloudinary/cloudinary.service';

import {
  SendMessageDto,
  SendMediaMessageDto,
  EditMessageDto,
  MessageIdDto,
  SetPrivacyDto,
} from './dto';

const MAX_CHAT_FILE_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME =
  /^(image\/(jpeg|png|webp|avif|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|ogg|webm|aac)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint|zip|octet-stream)|text\/plain)$/i;

function messageTypeForMime(mimeType: string): MessageType {
  if (mimeType.startsWith('image/')) {
    return MessageType.IMAGE;
  }

  if (mimeType.startsWith('video/')) {
    return MessageType.VIDEO;
  }

  if (mimeType.startsWith('audio/')) {
    return MessageType.AUDIO;
  }

  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('msword') ||
    mimeType.includes('wordprocessingml')
  ) {
    return MessageType.DOCUMENT;
  }

  return MessageType.FILE;
}

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
    private readonly cloudinary: CloudinaryService,
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

  @Post('send-media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_CHAT_FILE_BYTES },
    }),
  )
  async sendMedia(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMediaMessageDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: MAX_CHAT_FILE_BYTES,
          }),
          new FileTypeValidator({
            fileType: ALLOWED_MIME,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }

    const uploaded = await this.cloudinary.uploadChatMedia(
      file,
      'neighborhood/chat',
    );

    // Your ChatService.send() already supports media as argument 4.
    const result = await this.chat.send(
      user.id,
      dto.recipientId,
      dto.text,
      {
        url: uploaded.url,
        publicId: uploaded.publicId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        type: messageTypeForMime(file.mimetype),
      },
    );

    this.gateway.publishMessage(
      user.id,
      dto.recipientId,
      result,
    );

    return result;
  }

  @Patch('messages/:messageId')
  async editMessage(
    @CurrentUser() user: AuthUser,
    @Param() params: MessageIdDto,
    @Body() dto: EditMessageDto,
  ) {
    const message = await this.chat.updateMessage(
      user.id,
      params.messageId,
      dto.text,
    );

    const participants =
      await this.chat.getConversationParticipants(
        user.id,
        message.conversationId,
      );

    // Gateway signature: userAId, userBId, message
    this.gateway.publishMessageUpdate(
      participants.userAId,
      participants.userBId,
      message,
    );

    return message;
  }

  @Delete('messages/:messageId')
  async deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param() params: MessageIdDto,
  ) {
    const result = await this.chat.deleteMessage(
      user.id,
      params.messageId,
    );

    const participants =
      await this.chat.getConversationParticipants(
        user.id,
        result.conversationId,
      );

    // Gateway signature: userAId, userBId, conversationId,
    // messageId, deletedAt
    this.gateway.publishMessageDelete(
      participants.userAId,
      participants.userBId,
      result.conversationId,
      result.id,
      result.deletedAt,
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

    const participants =
      await this.chat.getConversationParticipants(
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
