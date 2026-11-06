import { ServiceBookingStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(70)
  yearsExperience?: number;

  /** Free text, for example "Lekki, Ajah and Victoria Island". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  serviceArea?: string;
}

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Starting price in naira. Leave out for "price on request". */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  basePrice?: number;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  basePrice?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ArtisanQueryDto {
  /** Matches headline, bio or a service name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serviceArea?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  verifiedOnly?: boolean;

  @IsOptional()
  @IsIn(['rating', 'jobs', 'newest'])
  sort?: 'rating' | 'jobs' | 'newest';

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateBookingDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description!: string;

  /** The time the customer would like the work done. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  address!: string;

  /** Defaults to the customer's own number. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  /** Defaults to the customer's primary neighborhood. */
  @IsOptional()
  @IsUUID()
  neighborhoodId?: string;
}

export class AcceptBookingDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  quotedPrice?: number;
}

export class ScheduleBookingDto {
  @IsDateString()
  scheduledAt!: string;
}

export class CompleteBookingDto {
  /** Defaults to the quoted price. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  finalPrice?: number;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class BookingQueryDto {
  @IsOptional()
  @IsEnum(ServiceBookingStatus)
  status?: ServiceBookingStatus;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class VerifyArtisanDto {
  @IsBoolean()
  isVerified!: boolean;
}

export class ReviewQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}