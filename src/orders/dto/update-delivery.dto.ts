import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

export class UpdateDeliveryDto {
  @IsEnum(DeliveryStatus)
  @IsNotEmpty()
  status!: DeliveryStatus;

  @IsString()
  @IsOptional()
  failedReason?: string;
}