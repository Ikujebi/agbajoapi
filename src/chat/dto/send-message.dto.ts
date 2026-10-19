
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  recipientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;
}
