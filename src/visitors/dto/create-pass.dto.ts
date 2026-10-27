import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreatePassDto {
  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  visitorName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  visitorPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  validUntil!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxEntries?: number;

  /** The unit the visitor is going to. Required when shareDirections is true. */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  /** The host opts in to sending the visitor a map to the unit. */
  @IsOptional()
  @IsBoolean()
  shareDirections?: boolean;

  /** Text the visitor their pass code (and the map link, if shared). Needs visitorPhone. */
  @IsOptional()
  @IsBoolean()
  sendSms?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  visitorEmail?: string;

  /** Email the visitor their pass code (and the map link, if shared). Needs visitorEmail. */
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}