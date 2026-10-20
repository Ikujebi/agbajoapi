import { NoticeStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateNoticeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  /** DRAFT keeps it private. Defaults to PUBLISHED. */
  @IsOptional()
  @IsEnum(NoticeStatus)
  status?: NoticeStatus;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateNoticeDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsEnum(NoticeStatus)
  status?: NoticeStatus;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
