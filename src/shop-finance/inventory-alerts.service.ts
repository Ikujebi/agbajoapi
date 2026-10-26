import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rolesWith } from '../common/permissions/permissions';

@Injectable()
export class InventoryAlertsService {
  private readonly log = new Logger(InventoryAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Every morning, tells the people who can restock (owner, manager) which
   * shops have products at or below their low-stock level.
   * Needs ScheduleModule.forRoot() in AppModule.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async notifyLowStock(): Promise<void> {
    let shops: { organizationId: string; count: bigint }[];

    try {
      shops = await this.prisma.$queryRaw<
        { organizationId: string; count: bigint }[]
      >`
        SELECT p."organizationId", COUNT(*) AS count
        FROM "Product" p
        JOIN "Organization" o ON o."id" = p."organizationId"
        WHERE o."type"::text = 'SHOP'
          AND o."isActive" = true
          AND p."status"::text = 'ACTIVE'
          AND p."quantity" <= p."lowStockAt"
        GROUP BY p."organizationId"`;
    } catch (error) {
      this.log.error(`Low-stock query failed: ${(error as Error).message}`);
      return;
    }

    for (const shop of shops) {
      try {
        const staff = await this.prisma.membership.findMany({
          where: {
            organizationId: shop.organizationId,
            status: 'APPROVED',
            role: { in: rolesWith('SHOP', 'stock.adjust') },
          },
          select: { userId: true },
        });

        const count = Number(shop.count);

        await this.notifications.send(
          staff.map((member) => member.userId),
          {
            type: 'SYSTEM',
            title: 'Low stock',
            body: `${count} product${count === 1 ? ' is' : 's are'} running low.`,
            data: { organizationId: shop.organizationId },
          },
        );
      } catch (error) {
        this.log.error(
          `Low-stock alert failed for ${shop.organizationId}: ${(error as Error).message}`,
        );
      }
    }
  }
}
