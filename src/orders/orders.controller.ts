import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { AssignAgentDto, CreateOrderDto, UpdateDeliveryDto, UpdateOrderStatusDto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post('orders') create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto) { return this.orders.create(u.id, dto); }
  @Get('orders/mine') mine(@CurrentUser() u: AuthUser) { return this.orders.mine(u.id); }

  @Get('orders/shop/:orgId')
  shop(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Query('status') status?: OrderStatus) {
    return this.orders.shopOrders(u.id, orgId, status);
  }

  @Get('orders/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orders.get(u.id, id); }

  @Patch('orders/:id/status')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(u.id, id, dto.status);
  }

  @Post('orders/:id/delivery/assign')
  assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AssignAgentDto) {
    return this.orders.assignAgent(u.id, id, dto);
  }

  @Patch('deliveries/:id/status')
  delivery(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDeliveryDto) {
    return this.orders.updateDelivery(u.id, id, dto);
  }
}
