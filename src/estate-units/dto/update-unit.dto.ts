import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { Trim } from './trim';

/** Send null (or an empty string) to clear building, unitType or ownerId. */
export class UpdateUnitDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unitNumber?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  building?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  unitType?: string | null;

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
