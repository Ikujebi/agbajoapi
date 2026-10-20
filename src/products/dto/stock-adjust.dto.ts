import { StockMovementType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class StockAdjustDto {
  /** Positive adds stock, negative removes it. Zero is rejected by the service. */
  @IsInt()
  delta!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  /**
   * SALE and RETURN need sale.record (attendants have it).
   * RESTOCK, DAMAGE and ADJUSTMENT need stock.adjust.
   * Defaults to ADJUSTMENT.
   */
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;
}