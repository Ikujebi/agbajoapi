import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price: number;
  @IsInt() @Min(0) quantity: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() imageUrl?: string;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StockAdjustDto {
  @IsInt() delta: number; // +10 restock, -2 sale/damage
  @IsOptional() @IsString() reason?: string;
}
