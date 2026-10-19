import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MembershipRole, NotificationType, OrderStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { FINANCE_ROLES, SHOP_STAFF_ROLES } from '../common/roles';
import { AssignAgentDto, CreateOrderDto, UpdateDeliveryDto } from './dto';

type Tx = Prisma.TransactionClient;

/**
 * Stock invariant:
 *  - creating an order RESERVES stock (product.reservedQty += qty)
 *  - PENDING -> CONFIRMED COMMITS it (quantity -= qty, reservedQty -= qty, SALE movement)
 *  - PENDING -> CANCELLED releases the reservation
 *  - CONFIRMED.. -> CANCELLED puts stock back (RETURN movement)
 */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_PICKUP: ['DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

const CUSTOMER_TEXT: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'has been confirmed',
  PROCESSING: 'is being prepared',
  READY_FOR_PICKUP: 'is ready for pickup',
  OUT_FOR_DELIVERY: 'is on its way',
  DELIVERED: 'has been delivered',
  CANCELLED: 'was cancelled',
};

const UNPAID_EXPIRY_MS = 30 * 60 * 1000;

@Injectable()
export class OrdersService {
  private readonly log = new Logger(OrdersService.name);

  constructor(private prisma: PrismaService, private orgs: OrganizationsService, private config: ConfigService) {}

  // ---------- helpers ----------
  private async hasRole(userId: string, organizationId: string, roles: MembershipRole[]) {
    const m = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    return !!m && m.status === 'APPROVED' && roles.includes(m.role);
  }

  private async staffIds(organizationId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId, status: 'APPROVED', role: { in: SHOP_STAFF_ROLES } }, select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  private async notify(userIds: string[], type: NotificationType, title: string, body: string, data?: Prisma.InputJsonValue) {
    if (!userIds.length) return;
    await this.prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type, title, body, data })) });
  }

  private newOrderNumber() {
    const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `NB-${d}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  // ---------- stock ----------
  private async commitStock(tx: Tx, orderId: string, actorId?: string) {
    const items = await tx.orderItem.findMany({ where: { orderId, productId: { not: null } } });
    for (const it of items) {
      const p = await tx.product.update({
        where: { id: it.productId! },
        data: { quantity: { decrement: it.quantity }, reservedQty: { decrement: it.quantity } },
      });
      await tx.stockMovement.create({
        data: { productId: p.id, type: 'SALE', delta: -it.quantity, quantityAfter: p.quantity, reason: 'Order confirmed', reference: orderId, createdById: actorId },
      });
    }
  }

  private async releaseReservation(tx: Tx, orderId: string) {
    const items = await tx.orderItem.findMany({ where: { orderId, productId: { not: null } } });
    for (const it of items) {
      await tx.product.update({ where: { id: it.productId! }, data: { reservedQty: { decrement: it.quantity } } });
    }
  }

  private async returnStock(tx: Tx, orderId: string, actorId?: string) {
    const items = await tx.orderItem.findMany({ where: { orderId, productId: { not: null } } });
    for (const it of items) {
      const p = await tx.product.update({ where: { id: it.productId! }, data: { quantity: { increment: it.quantity } } });
      await tx.stockMovement.create({
        data: { productId: p.id, type: 'RETURN', delta: it.quantity, quantityAfter: p.quantity, reason: 'Order cancelled', reference: orderId, createdById: actorId },
      });
    }
  }

  /** Called by PaymentsService inside its transaction once online payment succeeds. */
  async confirmOrderTx(tx: Tx, orderId: string) {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return { confirmed: false, reason: 'missing' as const };
    if (order.status !== 'PENDING') return { confirmed: false, reason: order.status };
    await this.commitStock(tx, orderId);
    await tx.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } });
    return { confirmed: true as const };
  }

  async notifyPaid(orderId: string, lateReason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    if (lateReason) {
      await this.notify([order.customerId], 'PAYMENT', 'Payment received for a cancelled order',
        `We received your payment for order ${order.orderNumber}, but the order was already ${lateReason.toLowerCase()}. It will be refunded.`, { orderId });
      await this.notify(await this.staffIds(order.organizationId), 'PAYMENT', 'Refund needed',
        `Payment arrived for ${order.orderNumber} after it was ${lateReason.toLowerCase()}. Please refund the customer.`, { orderId });
      return;
    }
    await this.notify([order.customerId], 'PAYMENT', 'Payment received', `Order ${order.orderNumber} is paid and confirmed.`, { orderId });
    await this.notify(await this.staffIds(order.organizationId), 'ORDER', 'Paid order',
      `Order ${order.orderNumber} (₦${order.totalAmount.toFixed(2)}) has been paid.`, { orderId });
  }

  // ---------- create ----------
  async create(userId: string, dto: CreateOrderDto) {
    const org = await this.orgs.getOrThrow(dto.organizationId);
    if (org.type !== 'SHOP' || !org.isActive) throw new BadRequestException('This shop is not accepting orders');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const qtyById = new Map<string, number>();
    for (const it of dto.items) qtyById.set(it.productId, (qtyById.get(it.productId) ?? 0) + it.quantity);

    const products = await this.prisma.product.findMany({
      where: { id: { in: [...qtyById.keys()] }, organizationId: org.id, status: 'ACTIVE', isAvailable: true },
    });
    if (products.length !== qtyById.size) throw new BadRequestException('One or more products are unavailable');

    const delivery = !!dto.deliveryAddress?.trim();
    const deliveryFee = new Prisma.Decimal(delivery ? Number(this.config.get('DELIVERY_FEE')) || 0 : 0);
    const lines = products.map((p) => {
      const quantity = qtyById.get(p.id)!;
      return { p, quantity, lineTotal: p.price.mul(quantity) };
    });
    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), new Prisma.Decimal(0));
    const total = subtotal.add(deliveryFee);
    const customerName = dto.customerName?.trim() || user.fullName;
    const customerPhone = dto.customerPhone?.trim() || user.phone;

    const order = await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        // atomic check-and-reserve; fails if someone else grabbed the stock
        const n = await tx.$executeRaw`UPDATE "Product" SET "reservedQty" = "reservedQty" + ${l.quantity}::int
          WHERE "id" = ${l.p.id} AND "quantity" - "reservedQty" >= ${l.quantity}::int`;
        if (n === 0) throw new BadRequestException(`Not enough stock for ${l.p.name}`);
      }
      return tx.order.create({
        data: {
          orderNumber: this.newOrderNumber(),
          organizationId: org.id, customerId: userId,
          subtotal, deliveryFee, totalAmount: total,
          customerName, customerPhone,
          deliveryAddress: delivery ? dto.deliveryAddress!.trim() : null,
          deliveryNotes: dto.deliveryNotes,
          items: {
            create: lines.map((l) => ({
              productId: l.p.id, productName: l.p.name, sku: l.p.sku,
              quantity: l.quantity, unitPrice: l.p.price, lineTotal: l.lineTotal,
            })),
          },
          ...(dto.payCash && {
            payments: { create: { organizationId: org.id, payerId: userId, amount: total, method: 'CASH', status: 'PENDING' } },
          }),
          ...(delivery && {
            delivery: {
              create: {
                organizationId: org.id, deliveryAddress: dto.deliveryAddress!.trim(), pickupAddress: org.address,
                recipientName: customerName, recipientPhone: customerPhone,
                trackingCode: `TRK-${randomBytes(4).toString('hex').toUpperCase()}`,
              },
            },
          }),
        },
        include: { items: true, payments: true, delivery: true },
      });
    });

    await this.notify(await this.staffIds(org.id), 'ORDER', 'New order',
      `${order.orderNumber} · ₦${total.toFixed(2)} · ${dto.payCash ? 'pay on ' + (delivery ? 'delivery' : 'pickup') : 'awaiting online payment'}`, { orderId: order.id });
    return order;
  }

  // ---------- read ----------
  private readonly include = {
    items: true, payments: true,
    delivery: { include: { assignedAgent: { select: { id: true, fullName: true, phone: true } } } },
    organization: { select: { id: true, name: true, phone: true } },
  } satisfies Prisma.OrderInclude;

  mine(userId: string) {
    return this.prisma.order.findMany({ where: { customerId: userId }, include: this.include, orderBy: { placedAt: 'desc' }, take: 100 });
  }

  async shopOrders(userId: string, organizationId: string, status?: OrderStatus) {
    await this.orgs.assertRole(userId, organizationId, FINANCE_ROLES.concat('STAFF'));
    return this.prisma.order.findMany({
      where: { organizationId, ...(status && { status }) }, include: this.include, orderBy: { placedAt: 'desc' }, take: 200,
    });
  }

  async get(userId: string, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== userId && !(await this.hasRole(userId, order.organizationId, FINANCE_ROLES.concat('STAFF')))) {
      throw new ForbiddenException();
    }
    return order;
  }

  // ---------- status changes ----------
  private async applyStatus(order: { id: string; status: OrderStatus }, to: OrderStatus, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: to, ...(to === 'CANCELLED' && { cancelledAt: new Date() }) },
      });
      if (claimed.count === 0) throw new ConflictException('This order was just updated by someone else. Refresh and retry.');

      if (order.status === 'PENDING' && to === 'CONFIRMED') await this.commitStock(tx, order.id, actorId);

      if (to === 'CANCELLED') {
        if (order.status === 'PENDING') await this.releaseReservation(tx, order.id);
        else await this.returnStock(tx, order.id, actorId);
        await tx.delivery.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
        await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      }

      if (to === 'DELIVERED') {
        await tx.payment.updateMany({
          where: { orderId: order.id, method: 'CASH', status: 'PENDING' }, data: { status: 'SUCCEEDED', paidAt: new Date() },
        });
        await tx.delivery.updateMany({
          where: { orderId: order.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, data: { status: 'DELIVERED', deliveredAt: new Date() },
        });
      }
    });
  }

  async updateStatus(userId: string, orderId: string, to: OrderStatus) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { payments: true, delivery: true } });
    if (!order) throw new NotFoundException('Order not found');

    const staff = await this.hasRole(userId, order.organizationId, SHOP_STAFF_ROLES);
    const isCustomer = order.customerId === userId;
    if (!staff && !(isCustomer && to === 'CANCELLED' && order.status === 'PENDING')) {
      throw new ForbiddenException('You cannot make this change');
    }
    if (!NEXT[order.status].includes(to)) throw new BadRequestException(`Cannot move an order from ${order.status} to ${to}`);
    if (to === 'CONFIRMED' && !order.payments.some((p) => p.method === 'CASH')) {
      throw new BadRequestException('Online orders are confirmed automatically once paid');
    }
    if (to === 'OUT_FOR_DELIVERY' && !order.delivery) throw new BadRequestException('This order has no delivery address');
    if (to === 'READY_FOR_PICKUP' && order.delivery) throw new BadRequestException('This is a delivery order');

    await this.applyStatus(order, to, userId);

    const refundRequired = to === 'CANCELLED' && order.payments.some((p) => p.status === 'SUCCEEDED' && p.method !== 'CASH');
    if (isCustomer && !staff) {
      await this.notify(await this.staffIds(order.organizationId), 'ORDER', 'Order cancelled', `${order.orderNumber} was cancelled by the customer.`, { orderId });
    } else {
      await this.notify([order.customerId], 'ORDER', 'Order update',
        `Your order ${order.orderNumber} ${CUSTOMER_TEXT[to] ?? to.toLowerCase()}.${refundRequired ? ' Your refund will be processed by the shop.' : ''}`, { orderId });
    }
    return { id: order.id, status: to, refundRequired };
  }

  // ---------- delivery ----------
  async assignAgent(userId: string, orderId: string, dto: AssignAgentDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { delivery: true } });
    if (!order) throw new NotFoundException('Order not found');
    await this.orgs.assertRole(userId, order.organizationId, SHOP_STAFF_ROLES);
    if (!order.delivery) throw new BadRequestException('This order has no delivery');
    if (['DELIVERED', 'CANCELLED'].includes(order.delivery.status)) throw new BadRequestException('Delivery already closed');
    if (!(await this.hasRole(dto.agentId, order.organizationId, SHOP_STAFF_ROLES))) {
      throw new BadRequestException('Agent must be an approved staff member of this shop');
    }
    const updated = await this.prisma.delivery.update({
      where: { id: order.delivery.id },
      data: { assignedAgentId: dto.agentId, status: 'ASSIGNED', assignedAt: new Date() },
    });
    await this.notify([dto.agentId], 'DELIVERY', 'New delivery', `Deliver order ${order.orderNumber} to ${order.delivery.deliveryAddress}.`, { orderId });
    await this.notify([order.customerId], 'DELIVERY', 'Rider assigned', `A rider has been assigned to order ${order.orderNumber}.`, { orderId });
    return updated;
  }

  async updateDelivery(userId: string, deliveryId: string, dto: UpdateDeliveryDto) {
    const d = await this.prisma.delivery.findUnique({ where: { id: deliveryId }, include: { order: true } });
    if (!d) throw new NotFoundException('Delivery not found');
    const staff = await this.hasRole(userId, d.organizationId, SHOP_STAFF_ROLES);
    if (!staff && d.assignedAgentId !== userId) throw new ForbiddenException();
    if (!['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED'].includes(dto.status)) throw new BadRequestException('Invalid status');
    if (['DELIVERED', 'CANCELLED'].includes(d.status)) throw new BadRequestException('Delivery already closed');

    let cur = d.order;
    if (dto.status === 'PICKED_UP' || dto.status === 'DELIVERED') {
      if (cur.status === 'PROCESSING') {
        await this.applyStatus(cur, 'OUT_FOR_DELIVERY', userId);
        cur = { ...cur, status: 'OUT_FOR_DELIVERY' };
      }
    }
    if (dto.status === 'DELIVERED' && cur.status === 'OUT_FOR_DELIVERY') await this.applyStatus(cur, 'DELIVERED', userId);

    const now = new Date();
    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: dto.status,
        ...(dto.status === 'PICKED_UP' && { pickedUpAt: now }),
        ...(dto.status === 'DELIVERED' && { deliveredAt: now }),
        ...(dto.status === 'FAILED' && { failedReason: dto.failedReason ?? 'Not specified' }),
      },
    });

    if (dto.status === 'FAILED') {
      await this.notify(await this.staffIds(d.organizationId), 'DELIVERY', 'Delivery failed', `${d.order.orderNumber}: ${updated.failedReason}`, { orderId: d.orderId });
    }
    await this.notify([d.order.customerId], 'DELIVERY', 'Delivery update',
      `Order ${d.order.orderNumber}: ${dto.status.replace('_', ' ').toLowerCase()}.`, { orderId: d.orderId });
    return updated;
  }

  // ---------- housekeeping ----------
  /** Frees reserved stock for online orders that were never paid. Needs ScheduleModule.forRoot(). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireUnpaid() {
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING', placedAt: { lt: new Date(Date.now() - UNPAID_EXPIRY_MS) },
        payments: { none: { method: 'CASH' } },
      },
      select: { id: true, customerId: true, orderNumber: true }, take: 100,
    });
    for (const o of stale) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const c = await tx.order.updateMany({ where: { id: o.id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
          if (!c.count) return false;
          await this.releaseReservation(tx, o.id);
          await tx.payment.updateMany({ where: { orderId: o.id, status: 'PENDING' }, data: { status: 'FAILED' } });
          await tx.delivery.updateMany({ where: { orderId: o.id }, data: { status: 'CANCELLED' } });
          return true;
        });
        if (done) await this.notify([o.customerId], 'ORDER', 'Order expired', `Order ${o.orderNumber} was cancelled because it wasn't paid in time.`, { orderId: o.id });
      } catch (e) {
        this.log.error(`Failed to expire order ${o.id}: ${(e as Error).message}`);
      }
    }
  }
}
