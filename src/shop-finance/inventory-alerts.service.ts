
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rolesWith } from '../common/permissions/permissions';
import { MailService } from '../mail/mail.service';
import {
  inventoryLowStockTemplate,
  LowStockProduct,
} from '../mail/templates';

@Injectable()
export class InventoryAlertsService {
  private readonly log = new Logger(InventoryAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Every morning, notifies approved shop owners and managers
   * who have stock.adjust permission.
   *
   * Sends both in-app and email notifications.
   *
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
      this.log.error(
        `Low-stock query failed: ${(error as Error).message}`,
      );
      return;
    }

    for (const shop of shops) {
      try {
        const [organization, products, staff] = await Promise.all([
          this.prisma.organization.findUnique({
            where: { id: shop.organizationId },
            select: { name: true },
          }),

          this.prisma.product.findMany({
            where: {
              organizationId: shop.organizationId,
              status: 'ACTIVE',
              quantity: { lte: this.prisma.product.fields.lowStockAt },
            },
            select: {
              name: true,
              quantity: true,
              lowStockAt: true,
            },
            orderBy: { quantity: 'asc' },
          }),

          this.prisma.membership.findMany({
            where: {
              organizationId: shop.organizationId,
              status: 'APPROVED',
              role: {
                in: rolesWith('SHOP', 'stock.adjust'),
              },
            },
            select: {
              userId: true,
              user: {
                select: {
                  email: true,
                  firstName: true,
                },
              },
            },
          }),
        ]);

        if (!organization || products.length === 0 || staff.length === 0) {
          continue;
        }

        const count = products.length;

        // Keep the existing in-app notification.
        try {
          await this.notifications.send(
            [...new Set(staff.map((member) => member.userId))],
            {
              type: 'SYSTEM',
              title: 'Low stock',
              body: `${count} product${count === 1 ? ' is' : 's are'} running low.`,
              data: { organizationId: shop.organizationId },
            },
          );
        } catch (error) {
          this.log.error(
            `In-app low-stock notification failed for ${shop.organizationId}: ${(error as Error).message}`,
          );
        }

        // Prepare the email product list.
        const emailProducts: LowStockProduct[] = products.map((product) => ({
          name: product.name,
          quantity: product.quantity,
          lowStockAt: product.lowStockAt,
        }));

        // Deduplicate staff by email.
        const recipients = new Map<
          string,
          { email: string; firstName?: string }
        >();

        for (const member of staff) {
          const email = member.user.email?.trim();

          if (
            !email ||
            email.toLowerCase().endsWith('@pay.neighborhood.app')
          ) {
            continue;
          }

          recipients.set(email.toLowerCase(), {
            email,
            firstName: member.user.firstName || undefined,
          });
        }

        const html = inventoryLowStockTemplate({
          organizationName: organization.name,
          products: emailProducts,
        });

        await Promise.all(
          [...recipients.values()].map(async (recipient) => {
            try {
              const personalizedHtml = inventoryLowStockTemplate({
                organizationName: organization.name,
                products: emailProducts,
                recipientName: recipient.firstName,
              });

              await this.mail.send(
                recipient.email,
                `Low stock alert — ${organization.name}`,
                personalizedHtml,
              );
            } catch (error) {
              this.log.warn(
                `Could not send low-stock email to ${recipient.email}: ${(error as Error).message}`,
              );
            }
          }),
        );

        this.log.log(
          `Low-stock alerts processed for ${organization.name}: ${count} product(s), ${recipients.size} email recipient(s).`,
        );
      } catch (error) {
        this.log.error(
          `Low-stock alert failed for ${shop.organizationId}: ${(error as Error).message}`,
        );
      }
    }
  }
}
