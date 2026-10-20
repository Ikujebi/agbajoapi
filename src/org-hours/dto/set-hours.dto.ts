import { HoursKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayHoursDto {
  /** 0 = Sunday ... 6 = Saturday */
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @IsOptional()
  @Matches(HHMM, { message: 'opensAt must be HH:mm in 24-hour time' })
  opensAt?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'closesAt must be HH:mm in 24-hour time' })
  closesAt?: string;
}

export class SetHoursDto {
  /** OPENING (default) for shops and others, VISITING for estates. */
  @IsOptional()
  @IsEnum(HoursKind)
  kind?: HoursKind;

  /** IANA timezone, for example Africa/Lagos. */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** Days left out of this list are treated as closed. */
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayHoursDto)
  days!: DayHoursDto[];
}

export class SetAcceptingOrdersDto {
  @IsBoolean()
  accepting!: boolean;
}