import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MembershipRole,
  NotificationType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrgHoursService } from '../org-hours/org-hours.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { rolesWith } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  AssignAgentDto,
  CreateOrderDto,
  UpdateDeliveryDto,
  UpdateOrderStatusDto,
} from './dto';
import { NotificationsService } from '../notifications/notifications.service';

type Tx = Prisma.TransactionClient;

/**
 * Stock invariant:
 * - Creating an order reserves stock (reservedQty += quantity).
 * - PENDING -> CONFIRMED commits stock (quantity -= quantity, reservedQty -= quantity).
 * - PENDING -> CANCELLED releases the reservation.
 * - CONFIRMED or later -> CANCELLED returns stock.
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrganizationsService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionsService,
    private readonly hours: OrgHoursService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- helpers ----------

  private async hasRole(
    userId: string,
    organizationId: string,
    roles: MembershipRole[],
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
    });

    return (
      !!membership &&
      membership.status === 'APPROVED' &&
      roles.includes(membership.role)
    );
  }

  /** Everyone at the shop who handles orders. */
  private async staffIds(organizationId: string) {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        role: { in: rolesWith('SHOP', 'order.manage') },
      },
      select: { userId: true },
    });

    return rows.map((row) => row.userId);
  }

  private async notify(
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string | number | null>,
  ) {
    if (userIds.length === 0) return;

    await this.notifications.send(userIds, {
      type,
      title,
      body,
      data,
    });
  }

  private newOrderNumber() {
    const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `NB-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  /** Builds a display name from the separate user name fields. */
  private formatUserName(user: {
    firstName: string;
    otherNames: string | null;
    lastName: string;
  }) {
    return [user.firstName, user.otherNames, user.lastName]
      .filter((name) => name?.trim())
      .join(' ');
  }

  // ---------- stock ----------

  private async commitStock(tx: Tx, orderId: string, actorId?: string) {
    const items = await tx.orderItem.findMany({
      where: { orderId, productId: { not: null } },
      orderBy: { productId: 'asc' },
    });

    for (const item of items) {
      const product = await tx.product.update({
        where: { id: item.productId! },
        data: {
          quantity: { decrement: item.quantity },
          reservedQty: { decrement: item.quantity },
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: 'SALE',
          delta: -item.quantity,
          quantityAfter: product.quantity,
          reason: 'Order confirmed',
          reference: orderId,
          createdById: actorId,
        },
      });
    }
  }

  private async releaseReservation(tx: Tx, orderId: string) {
    const items = await tx.orderItem.findMany({
      where: { orderId, productId: { not: null } },
      orderBy: { productId: 'asc' },
    });

    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId! },
        data: {
          reservedQty: { decrement: item.quantity },
        },
      });
    }
  }

  private async returnStock(tx: Tx, orderId: string, actorId?: string) {
    const items = await tx.orderItem.findMany({
      where: { orderId, productId: { not: null } },
      orderBy: { productId: 'asc' },
    });

    for (const item of items) {
      const product = await tx.product.update({
        where: { id: item.productId! },
        data: {
          quantity: { increment: item.quantity },
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: 'RETURN',
          delta: item.quantity,
          quantityAfter: product.quantity,
          reason: 'Order cancelled',
          reference: orderId,
          createdById: actorId,
        },
      });
    }
  }

  /** Called by PaymentsService inside its transaction after online payment succeeds. */
  async confirmOrderTx(tx: Tx, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return { confirmed: false, reason: 'missing' as const };
    }

    if (order.status !== 'PENDING') {
      return { confirmed: false, reason: order.status };
    }

    await this.commitStock(tx, orderId);

    await tx.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' },
    });

    return { confirmed: true as const };
  }

  async notifyPaid(orderId: string, lateReason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) return;

    if (lateReason) {
      await this.notify(
        [order.customerId],
        'PAYMENT',
        'Payment received for a cancelled order',
        `We received your payment for order ${order.orderNumber}, but the order was already ${lateReason.toLowerCase()}. It will be refunded.`,
        { orderId },
      );

      await this.notify(
        await this.staffIds(order.organizationId),
        'PAYMENT',
        'Refund needed',
        `Payment arrived for ${order.orderNumber} after it was ${lateReason.toLowerCase()}. Please refund the customer.`,
        { orderId },
      );

      return;
    }

    await this.notify(
      [order.customerId],
      'PAYMENT',
      'Payment received',
      `Order ${order.orderNumber} is paid and confirmed.`,
      { orderId },
    );

    await this.notify(
      await this.staffIds(order.organizationId),
      'ORDER',
      'Paid order',
      `Order ${order.orderNumber} (₦${order.totalAmount.toFixed(2)}) has been paid.`,
      { orderId },
    );
  }

  // ---------- create ----------

  async create(userId: string, dto: CreateOrderDto) {
    const org = await this.orgs.getOrThrow(dto.organizationId);

    if (org.type !== 'SHOP' || !org.isActive) {
      throw new BadRequestException('This shop is not accepting orders');
    }

    if (!org.acceptingOrders) {
      throw new BadRequestException(
        'This shop has paused orders. Please try again later.',
      );
    }

    await this.hours.assertOpen(
      org.id,
      'OPENING',
      `${org.name} is closed right now`,
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        otherNames: true,
        lastName: true,
        phone: true,
      },
    });

    const quantityByProductId = new Map<string, number>();

    for (const item of dto.items) {
      quantityByProductId.set(
        item.productId,
        (quantityByProductId.get(item.productId) ?? 0) + item.quantity,
      );
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: [...quantityByProductId.keys()] },
        organizationId: org.id,
        status: 'ACTIVE',
        isAvailable: true,
      },
    });

    if (products.length !== quantityByProductId.size) {
      throw new BadRequestException('One or more products are unavailable');
    }

    const delivery = !!dto.deliveryAddress?.trim();

    const deliveryFee = new Prisma.Decimal(
      delivery ? Number(this.config.get('DELIVERY_FEE')) || 0 : 0,
    );

    // Reserve stock in stable product-ID order.
    const lines = products
      .map((product) => {
        const quantity = quantityByProductId.get(product.id)!;

        return {
          product,
          quantity,
          lineTotal: product.price.mul(quantity),
        };
      })
      .sort((a, b) => (a.product.id < b.product.id ? -1 : 1));

    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    );

    const total = subtotal.add(deliveryFee);

    const customerName =
      dto.customerName?.trim() || this.formatUserName(user);

    const customerPhone = dto.customerPhone?.trim() || user.phone;

    const order = await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        // Atomic check-and-reserve prevents overselling.
        const affectedRows = await tx.$executeRaw`
          UPDATE "Product"
          SET "reservedQty" = "reservedQty" + ${line.quantity}::int
          WHERE "id" = ${line.product.id}
            AND "quantity" - "reservedQty" >= ${line.quantity}::int
        `;

        if (affectedRows === 0) {
          throw new BadRequestException(
            `Not enough stock for ${line.product.name}`,
          );
        }
      }

      return tx.order.create({
        data: {
          orderNumber: this.newOrderNumber(),
          organizationId: org.id,
          customerId: userId,
          subtotal,
          deliveryFee,
          totalAmount: total,
          customerName,
          customerPhone,
          deliveryAddress: delivery ? dto.deliveryAddress!.trim() : null,
          deliveryNotes: dto.deliveryNotes,
          items: {
            create: lines.map((line) => ({
              productId: line.product.id,
              productName: line.product.name,
              sku: line.product.sku,
              quantity: line.quantity,
              unitPrice: line.product.price,
              lineTotal: line.lineTotal,
            })),
          },
          ...(dto.payCash && {
            payments: {
              create: {
                organizationId: org.id,
                payerId: userId,
                amount: total,
                method: 'CASH',
                status: 'PENDING',
              },
            },
          }),
          ...(delivery && {
            delivery: {
              create: {
                organizationId: org.id,
                deliveryAddress: dto.deliveryAddress!.trim(),
                pickupAddress: org.address,
                recipientName: customerName,
                recipientPhone: customerPhone,
                trackingCode: `TRK-${randomBytes(4).toString('hex').toUpperCase()}`,
              },
            },
          }),
        },
        include: {
          items: true,
          payments: true,
          delivery: true,
        },
      });
    });

    await this.notify(
      await this.staffIds(org.id),
      'ORDER',
      'New order',
      `${order.orderNumber} · ₦${total.toFixed(2)} · ${
        dto.payCash
          ? `pay on ${delivery ? 'delivery' : 'pickup'}`
          : 'awaiting online payment'
      }`,
      { orderId: order.id },
    );

    return order;
  }

  // ---------- read ----------

  private readonly include = {
    items: true,
    payments: true,
    delivery: {
      include: {
        assignedAgent: {
          select: {
            id: true,
            firstName: true,
            otherNames: true,
            lastName: true,
            phone: true,
          },
        },
      },
    },
    organization: {
      select: {
        id: true,
        name: true,
        phone: true,
      },
    },
  } satisfies Prisma.OrderInclude;

  mine(userId: string) {
    return this.prisma.order.findMany({
      where: { customerId: userId },
      include: this.include,
      orderBy: { placedAt: 'desc' },
      take: 100,
    });
  }

  async shopOrders(
    user: AuthUser,
    organizationId: string,
    status?: OrderStatus,
  ) {
    await this.permissions.assert(user, organizationId, 'order.view');

    return this.prisma.order.findMany({
      where: {
        organizationId,
        ...(status && { status }),
      },
      include: this.include,
      orderBy: { placedAt: 'desc' },
      take: 200,
    });
  }

  async get(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: this.include,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isCustomer = order.customerId === user.id;
    const isAssignedRider = order.delivery?.assignedAgent?.id === user.id;

    if (
      !isCustomer &&
      !isAssignedRider &&
      !(await this.permissions.can(user, order.organizationId, 'order.view'))
    ) {
      throw new ForbiddenException();
    }

    return order;
  }

  // ---------- status changes ----------

  private async applyStatus(
    order: { id: string; status: OrderStatus },
    to: OrderStatus,
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          status: order.status,
        },
        data: {
          status: to,
          ...(to === 'CANCELLED' && { cancelledAt: new Date() }),
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'This order was just updated by someone else. Refresh and retry.',
        );
      }

      if (order.status === 'PENDING' && to === 'CONFIRMED') {
        await this.commitStock(tx, order.id, actorId);
      }

      if (to === 'CANCELLED') {
        if (order.status === 'PENDING') {
          await this.releaseReservation(tx, order.id);
        } else {
          await this.returnStock(tx, order.id, actorId);
        }

        await tx.delivery.updateMany({
          where: { orderId: order.id },
          data: { status: 'CANCELLED' },
        });

        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            status: 'PENDING',
          },
          data: { status: 'FAILED' },
        });
      }

      if (to === 'DELIVERED') {
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            method: 'CASH',
            status: 'PENDING',
          },
          data: {
            status: 'SUCCEEDED',
            paidAt: new Date(),
          },
        });

        await tx.delivery.updateMany({
          where: {
            orderId: order.id,
            status: { notIn: ['DELIVERED', 'CANCELLED'] },
          },
          data: {
            status: 'DELIVERED',
            deliveredAt: new Date(),
          },
        });
      }
    });
  }

  async updateStatus(
    user: AuthUser,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    const { status: to } = dto;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        delivery: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const staff = await this.permissions.can(
      user,
      order.organizationId,
      'order.manage',
    );

    const isCustomer = order.customerId === user.id;

    if (
      !staff &&
      !(isCustomer && to === 'CANCELLED' && order.status === 'PENDING')
    ) {
      throw new ForbiddenException('You cannot make this change');
    }

    if (!NEXT[order.status].includes(to)) {
      throw new BadRequestException(
        `Cannot move an order from ${order.status} to ${to}`,
      );
    }

    if (
      to === 'CONFIRMED' &&
      !order.payments.some((payment) => payment.method === 'CASH')
    ) {
      throw new BadRequestException(
        'Online orders are confirmed automatically once paid',
      );
    }

    if (to === 'OUT_FOR_DELIVERY' && !order.delivery) {
      throw new BadRequestException('This order has no delivery address');
    }

    if (to === 'READY_FOR_PICKUP' && order.delivery) {
      throw new BadRequestException('This is a delivery order');
    }

    await this.applyStatus(order, to, user.id);

    const refundRequired =
      to === 'CANCELLED' &&
      order.payments.some(
        (payment) =>
          payment.status === 'SUCCEEDED' && payment.method !== 'CASH',
      );

    if (isCustomer && !staff) {
      await this.notify(
        await this.staffIds(order.organizationId),
        'ORDER',
        'Order cancelled',
        `${order.orderNumber} was cancelled by the customer.`,
        { orderId },
      );
    } else {
      await this.notify(
        [order.customerId],
        'ORDER',
        'Order update',
        `Your order ${order.orderNumber} ${
          CUSTOMER_TEXT[to] ?? to.toLowerCase()
        }.${refundRequired ? ' Your refund will be processed by the shop.' : ''}`,
        { orderId },
      );
    }

    return {
      id: order.id,
      status: to,
      refundRequired,
    };
  }

  // ---------- delivery ----------

  async assignAgent(user: AuthUser, orderId: string, dto: AssignAgentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { delivery: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.permissions.assert(
      user,
      order.organizationId,
      'order.manage',
    );

    if (!order.delivery) {
      throw new BadRequestException('This order has no delivery');
    }

    if (['DELIVERED', 'CANCELLED'].includes(order.delivery.status)) {
      throw new BadRequestException('Delivery already closed');
    }

    const agentRoles = rolesWith('SHOP', 'delivery.perform');

    if (!(await this.hasRole(dto.agentId, order.organizationId, agentRoles))) {
      throw new BadRequestException(
        'Agent must be an approved rider or staff member of this shop',
      );
    }

    const updated = await this.prisma.delivery.update({
      where: { id: order.delivery.id },
      data: {
        assignedAgentId: dto.agentId,
        status: 'ASSIGNED',
        assignedAt: new Date(),
      },
    });

    await this.notify(
      [dto.agentId],
      'DELIVERY',
      'New delivery',
      `Deliver order ${order.orderNumber} to ${order.delivery.deliveryAddress}.`,
      { orderId },
    );

    await this.notify(
      [order.customerId],
      'DELIVERY',
      'Rider assigned',
      `A rider has been assigned to order ${order.orderNumber}.`,
      { orderId },
    );

    return updated;
  }

  async updateDelivery(
    user: AuthUser,
    deliveryId: string,
    dto: UpdateDeliveryDto,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: true },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    const staff = await this.permissions.can(
      user,
      delivery.organizationId,
      'order.manage',
    );

    if (!staff && delivery.assignedAgentId !== user.id) {
      throw new ForbiddenException();
    }

    if (
      !['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED'].includes(dto.status)
    ) {
      throw new BadRequestException('Invalid status');
    }

    if (['DELIVERED', 'CANCELLED'].includes(delivery.status)) {
      throw new BadRequestException('Delivery already closed');
    }

    let currentOrder = delivery.order;

    if (dto.status === 'PICKED_UP' || dto.status === 'DELIVERED') {
      if (currentOrder.status === 'PROCESSING') {
        await this.applyStatus(
          currentOrder,
          'OUT_FOR_DELIVERY',
          user.id,
        );

        currentOrder = {
          ...currentOrder,
          status: 'OUT_FOR_DELIVERY',
        };
      }
    }

    if (
      dto.status === 'DELIVERED' &&
      currentOrder.status === 'OUT_FOR_DELIVERY'
    ) {
      await this.applyStatus(currentOrder, 'DELIVERED', user.id);
    }

    const now = new Date();

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: dto.status,
        ...(dto.status === 'PICKED_UP' && { pickedUpAt: now }),
        ...(dto.status === 'DELIVERED' && { deliveredAt: now }),
        ...(dto.status === 'FAILED' && {
          failedReason: dto.failedReason ?? 'Not specified',
        }),
      },
    });

    if (dto.status === 'FAILED') {
      await this.notify(
        await this.staffIds(delivery.organizationId),
        'DELIVERY',
        'Delivery failed',
        `${delivery.order.orderNumber}: ${updated.failedReason}`,
        { orderId: delivery.orderId },
      );
    }

    await this.notify(
      [delivery.order.customerId],
      'DELIVERY',
      'Delivery update',
      `Order ${delivery.order.orderNumber}: ${dto.status
        .replace('_', ' ')
        .toLowerCase()}.`,
      { orderId: delivery.orderId },
    );

    return updated;
  }

  // ---------- housekeeping ----------

  /** Frees reserved stock for online orders that were never paid. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireUnpaid() {
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        placedAt: {
          lt: new Date(Date.now() - UNPAID_EXPIRY_MS),
        },
        payments: {
          none: { method: 'CASH' },
        },
      },
      select: {
        id: true,
        customerId: true,
        orderNumber: true,
      },
      take: 100,
    });

    for (const order of stale) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.order.updateMany({
            where: {
              id: order.id,
              status: 'PENDING',
            },
            data: {
              status: 'CANCELLED',
              cancelledAt: new Date(),
            },
          });

          if (!claimed.count) return false;

          await this.releaseReservation(tx, order.id);

          await tx.payment.updateMany({
            where: {
              orderId: order.id,
              status: 'PENDING',
            },
            data: { status: 'FAILED' },
          });

          await tx.delivery.updateMany({
            where: { orderId: order.id },
            data: { status: 'CANCELLED' },
          });

          return true;
        });

        if (done) {
          await this.notify(
            [order.customerId],
            'ORDER',
            'Order expired',
            `Order ${order.orderNumber} was cancelled because it wasn't paid in time.`,
            { orderId: order.id },
          );
        }
      } catch (error) {
        this.log.error(
          `Failed to expire order ${order.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
