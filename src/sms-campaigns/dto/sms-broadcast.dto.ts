import { MembershipRole } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SmsBroadcastDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;

  /** Limit the audience to these roles. Leave out to text every approved member. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(MembershipRole, { each: true })
  roles?: MembershipRole[];

  /**
   * Send the same key again after a timeout or double tap and you get the
   * original campaign back instead of a second charge.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
