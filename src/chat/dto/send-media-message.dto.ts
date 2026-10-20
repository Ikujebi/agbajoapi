import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const CHAT_MEDIA_TYPES = ['IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'DOCUMENT'] as const;
export type ChatMediaType = (typeof CHAT_MEDIA_TYPES)[number];

export class SendMediaMessageDto {
  @IsUUID()
  recipientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  // Set by the server based on the validated uploaded file, not trusted from clients.
  @IsOptional()
  @IsIn(CHAT_MEDIA_TYPES)
  type?: ChatMediaType;
}
