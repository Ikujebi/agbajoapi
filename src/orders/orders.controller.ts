import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import {
  AssignAgentDto,
  CreateOrderDto,
  UpdateDeliveryDto,
  UpdateOrderStatusDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(u.id, dto);
  }

  @Get('orders/mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.orders.mine(u.id);
  }

  @Get('orders/shop/:orgId')
  shop(
    @CurrentUser() u: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status', new ParseEnumPipe(OrderStatus, { optional: true }))
    status?: OrderStatus,
  ) {
    return this.orders.shopOrders(u, orgId, status);
  }

  @Get('orders/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(u, id);
  }

  @Patch('orders/:id/status')
  status(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(u, id, dto);
  }

  @Post('orders/:id/delivery/assign')
  assign(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAgentDto,
  ) {
    return this.orders.assignAgent(u, id, dto);
  }

  @Patch('deliveries/:id/status')
  delivery(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.orders.updateDelivery(u, id, dto);
  }
}