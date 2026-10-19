import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { DeliveryStatus, OrderStatus } from '@prisma/client';

export class OrderItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(1000) quantity: number;
}

export class CreateOrderDto {
  @IsUUID() organizationId: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  @IsOptional() @IsString() @MaxLength(20) customerPhone?: string;
  /** Provide an address to get delivery; leave empty for pickup. */
  @IsOptional() @IsString() @MaxLength(300) deliveryAddress?: string;
  @IsOptional() @IsString() @MaxLength(300) deliveryNotes?: string;
  /** true = pay cash on delivery/pickup, false/omitted = pay online. */
  @IsOptional() @IsBoolean() payCash?: boolean;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
}

export class AssignAgentDto {
  @IsUUID() agentId: string;
}

export class UpdateDeliveryDto {
  @IsEnum(DeliveryStatus) status: DeliveryStatus;
  @IsOptional() @IsString() @MaxLength(300) failedReason?: string;
}
