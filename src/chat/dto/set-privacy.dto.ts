
import { IsEnum } from 'class-validator';
import { ChatPrivacy } from '@prisma/client';

export class SetPrivacyDto {
  @IsEnum(ChatPrivacy)
  chatPrivacy!: ChatPrivacy;
}
