import { IsUUID } from 'class-validator';

export class MessageIdDto {
  @IsUUID()
  messageId!: string;
}
