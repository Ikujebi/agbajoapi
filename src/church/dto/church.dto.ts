import { AttendanceStatus, EventStatus, GivingType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// ---------- events ----------

export class CreateEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number;

  /** DRAFT (default) stays private. PUBLISHED notifies members. */
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number;

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

export class AttendanceEntryDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class MarkAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}

// ---------- giving ----------

export class RecordGivingDto {
  /** The member who gave. Leave out for cash collected without a name. */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsEnum(GivingType)
  type!: GivingType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  /** Receipt or transfer reference. Must be unique if given. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  /** Applies this payment to one of the member's pledges. */
  @IsOptional()
  @IsUUID()
  pledgeId?: string;
}

export class GiveOnlineDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100)
  @Max(5_000_000)
  amount!: number;

  /** Ignored when pledgeId is set. Defaults to DONATION. */
  @IsOptional()
  @IsEnum(GivingType)
  type?: GivingType;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @IsOptional()
  @IsUUID()
  pledgeId?: string;
}

export class CreatePledgeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100_000_000)
  targetAmount!: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  /** Admins can record a pledge on a member's behalf. */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
