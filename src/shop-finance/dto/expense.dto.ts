import { ExpenseCategory } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateExpenseDto {
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  amount!: number;

  @IsOptional()
  @IsDateString()
  incurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  amount?: number;

  @IsOptional()
  @IsDateString()
  incurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}
