import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ChatPrivacy } from '@prisma/client';

export class SendMessageDto {
  @IsUUID() recipientId: string;
  @IsString() @MinLength(1) @MaxLength(4000) text: string;
}

export class SetPrivacyDto {
  @IsEnum(ChatPrivacy) chatPrivacy: ChatPrivacy;
}
