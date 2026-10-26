import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { parseDate } from '../common/utils/dates';

/** Orders that count as sales: confirmed or later, not cancelled or refunded. */
const COMMITTED: OrderStatus[] = [
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;

const zero = () => new Prisma.Decimal(0);
const fmt = (value: Prisma.Decimal | null | undefined) =>
  (value ?? zero()).toFixed(2);

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Profit summary for a shop. Defaults to the current month, maximum one year.
   *
   *   gross profit = product revenue - cost of goods sold
   *   net profit   = gross profit + delivery fees - operating expenses
   *
   * Stock purchases are shown separately and are NOT subtracted from net
   * profit, because the cost of goods sold already accounts for the stock
   * you sold. Subtracting both would count the same money twice.
   */
  async summary(user: AuthUser, organizationId: string, from?: string, to?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true, timezone: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found.');
    }

    if (org.type !== 'SHOP') {
      throw new BadRequestException('The finance summary is only available for shops.');
    }

    await this.permissions.assert(user, organizationId, 'finance.view');

    const end = to ? parseDate(to, 'to') : new Date();
    const start = from
      ? parseDate(from, 'from')
      : new Date(end.getFullYear(), end.getMonth(), 1);

    if (end <= start) {
      throw new BadRequestException('"to" must be after "from".');
    }

    if (end.getTime() - start.getTime() > MAX_WINDOW_MS) {
      throw new BadRequestException('The period cannot be longer than one year.');
    }

    const orderWhere: Prisma.OrderWhereInput = {
      organizationId,
      status: { in: COMMITTED },
      placedAt: { gte: start, lt: end },
    };

    const [orders, cogsRows, collected, awaiting, expenses, orderRows, topProducts] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: orderWhere,
          _sum: { subtotal: true, deliveryFee: true, totalAmount: true },
          _count: true,
        }),
        this.prisma.$queryRaw<{ cogs: Prisma.Decimal; missing: bigint }[]>`
          SELECT COALESCE(SUM(oi."unitCost" * oi."quantity"), 0) AS cogs,
                 COUNT(*) FILTER (WHERE oi."unitCost" IS NULL) AS missing
          FROM "OrderItem" oi
          JOIN "Order" o ON o."id" = oi."orderId"
          WHERE o."organizationId" = ${organizationId}
            AND o."status"::text IN (${Prisma.join(COMMITTED)})
            AND o."placedAt" >= ${start} AND o."placedAt" < ${end}`,
        this.prisma.payment.aggregate({
          where: {
            organizationId,
            purpose: 'ORDER',
            status: 'SUCCEEDED',
            paidAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
        this.prisma.order.aggregate({
          where: { ...orderWhere, payments: { none: { status: 'SUCCEEDED' } } },
          _sum: { totalAmount: true },
          _count: true,
        }),
        this.prisma.expense.groupBy({
          by: ['category'],
          where: { organizationId, incurredAt: { gte: start, lt: end } },
          _sum: { amount: true },
        }),
        this.prisma.order.findMany({
          where: orderWhere,
          select: { placedAt: true, totalAmount: true },
          take: 50_000,
        }),
        this.prisma.orderItem.groupBy({
          by: ['productId', 'productName'],
          where: { order: orderWhere },
          _sum: { quantity: true, lineTotal: true },
          orderBy: { _sum: { lineTotal: 'desc' } },
          take: 10,
        }),
      ]);

    const subtotal = orders._sum.subtotal ?? zero();
    const deliveryFees = orders._sum.deliveryFee ?? zero();
    const cogs = new Prisma.Decimal(cogsRows[0]?.cogs ?? 0);
    const missingCost = Number(cogsRows[0]?.missing ?? 0);

    let operating = zero();
    let stockPurchases = zero();

    for (const row of expenses) {
      const amount = row._sum.amount ?? zero();

      if (row.category === 'STOCK_PURCHASE') {
        stockPurchases = stockPurchases.add(amount);
      } else {
        operating = operating.add(amount);
      }
    }

    const grossProfit = subtotal.sub(cogs);
    const netProfit = grossProfit.add(deliveryFees).sub(operating);

    // Sales per day in the shop's own timezone.
    const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone });
    const daily = new Map<string, { sales: Prisma.Decimal; orders: number }>();

    for (const row of orderRows) {
      const day = dayFormat.format(row.placedAt);
      const entry = daily.get(day) ?? { sales: zero(), orders: 0 };

      entry.sales = entry.sales.add(row.totalAmount);
      entry.orders += 1;
      daily.set(day, entry);
    }

    return {
      from: start,
      to: end,
      currency: 'NGN',
      orders: orders._count,
      sales: fmt(orders._sum.totalAmount),
      productRevenue: fmt(subtotal),
      deliveryFees: fmt(deliveryFees),
      costOfGoods: fmt(cogs),
      grossProfit: fmt(grossProfit),
      operatingExpenses: fmt(operating),
      netProfit: fmt(netProfit),
      stockPurchases: fmt(stockPurchases),
      collected: fmt(collected._sum.amount),
      awaitingPayment: {
        orders: awaiting._count,
        amount: fmt(awaiting._sum.totalAmount),
      },
      expensesByCategory: expenses.map((row) => ({
        category: row.category,
        total: fmt(row._sum.amount),
      })),
      topProducts: topProducts.map((row) => ({
        productId: row.productId,
        name: row.productName,
        quantity: row._sum.quantity ?? 0,
        revenue: fmt(row._sum.lineTotal),
      })),
      daily: [...daily.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({
          date,
          orders: value.orders,
          sales: fmt(value.sales),
        })),
      warnings:
        missingCost > 0
          ? [
              `${missingCost} sold item(s) have no recorded cost price (older orders or products without a cost), so cost of goods and profit are overstated.`,
            ]
          : [],
    };
  }

  /** Active products at or below their low-stock level. */
  async lowStock(user: AuthUser, organizationId: string) {
    await this.permissions.assert(user, organizationId, 'product.view');

    return this.prisma.$queryRaw<
      { id: string; name: string; quantity: number; lowStockAt: number }[]
    >`
      SELECT "id", "name", "quantity", "lowStockAt"
      FROM "Product"
      WHERE "organizationId" = ${organizationId}
        AND "status"::text = 'ACTIVE'
        AND "quantity" <= "lowStockAt"
      ORDER BY "quantity" ASC
      LIMIT 100`;
  }
}
