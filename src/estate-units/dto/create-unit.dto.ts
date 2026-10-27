import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { Trim } from './trim';

export class CreateUnitDto {
  @IsUUID()
  organizationId!: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unitNumber!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  building?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  unitType?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
