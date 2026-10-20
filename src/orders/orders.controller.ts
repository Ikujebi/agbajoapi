import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { AssignAgentDto, CreateOrderDto, UpdateDeliveryDto, UpdateOrderStatusDto } from './dto';

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
  shop(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Query('status') status?: OrderStatus) {
    // Pass the full AuthUser object 'u' instead of just 'u.id'
    return this.orders.shopOrders(u, orgId, status);
  }

  @Get('orders/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    // Pass the full AuthUser object 'u' instead of just 'u.id'
    return this.orders.get(u, id);
  }

  @Patch('orders/:id/status')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    // Pass the full AuthUser object 'u' instead of just 'u.id'
    return this.orders.updateStatus(u, id, dto);
  }

  @Post('orders/:id/delivery/assign')
  assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AssignAgentDto) {
    // Pass the full AuthUser object 'u' instead of just 'u.id'
    return this.orders.assignAgent(u, id, dto);
  }

  @Patch('deliveries/:id/status')
  delivery(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDeliveryDto) {
    // Pass the full AuthUser object 'u' instead of just 'u.id'
    return this.orders.updateDelivery(u, id, dto);
  }
}