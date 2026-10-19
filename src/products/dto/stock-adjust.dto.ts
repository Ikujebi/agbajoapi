import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockAdjustDto {
  @Type(() => Number)
  @IsInt()
  @NotEquals(0, {
    message: 'Stock adjustment must be a non-zero integer.',
  })
  delta!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}