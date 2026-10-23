import { EventStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateEventDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(300) location?: string | null;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() endsAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) capacity?: number | null;
  @IsOptional() @IsEnum(EventStatus) status?: EventStatus;
}
