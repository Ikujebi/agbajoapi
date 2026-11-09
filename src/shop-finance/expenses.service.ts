
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ExpenseCategory, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { rolesWith } from '../common/permissions/permissions';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { parseDate } from '../common/utils/dates';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

import { MailService } from '../mail/mail.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import {
  expenseActivityTemplate,
  ExpenseActivityType,
} from '../mail/templates';

type Tx = Prisma.TransactionClient;

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

@Injectable()
export class ExpensesService {
  private readonly log = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly cloudinary: CloudinaryService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
  ) {}

  /** Every change to money records leaves a trace, in the same transaction. */
  private audit(
    tx: Tx,
    user: AuthUser,
    organizationId: string,
    action: AuditAction,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        actorId: user.id,
        organizationId,
        action,
        entityType: 'Expense',
        entityId,
        metadata,
      },
    });
  }

  private checkDate(date: Date): Date {
    if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('incurredAt cannot be in the future.');
    }

    return date;
  }

  /**
   * Notify approved shop members who have finance.view.
   * Email errors must never interrupt the expense operation.
   */
  private async notifyFinanceStaff(
    organizationId: string,
    actorId: string,
    activity: ExpenseActivityType,
    expense: {
      id: string;
      description: string;
      category: ExpenseCategory;
      amount: Prisma.Decimal;
      incurredAt: Date;
      reference: string | null;
    },
    changes?: string[],
  ): Promise<void> {
    try {
      const [organization, staff] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        }),
        this.prisma.membership.findMany({
          where: {
            organizationId,
            status: 'APPROVED',
            role: { in: rolesWith('SHOP', 'finance.view') },
            userId: { not: actorId },
          },
          select: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
              },
            },
          },
        }),
      ]);

      if (!organization || staff.length === 0) {
        return;
      }

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

      if (recipients.size === 0) {
        return;
      }

      const subjectByActivity: Record<ExpenseActivityType, string> = {
        CREATED: 'New expense recorded',
        UPDATED: 'Expense record updated',
        DELETED: 'Expense record deleted',
        RECEIPT_ATTACHED: 'Expense receipt attached',
      };

      const baseOptions = {
        organizationName: organization.name,
        expenseId: expense.id,
        activity,
        description: expense.description,
        category: expense.category,
        amount: expense.amount.toFixed(2),
        incurredAt: expense.incurredAt,
        reference: expense.reference,
        changes,
      };

      await Promise.all(
        [...recipients.values()].map(async (recipient) => {
          try {
            const html = expenseActivityTemplate({
              ...baseOptions,
              recipientName: recipient.firstName,
            });

            await this.mail.send(
              recipient.email,
              subjectByActivity[activity],
              html,
              {
                idempotencyKey: `expense-${expense.id}-${activity}-${recipient.email.toLowerCase()}`,
              },
            );
          } catch (error) {
            this.log.warn(
              `Could not send expense email to ${recipient.email}: ${(error as Error).message}`,
            );
          }
        }),
      );
    } catch (error) {
      this.log.error(
        `Expense notification failed for ${organizationId}: ${(error as Error).message}`,
      );
    }
  }

  async create(
    user: AuthUser,
    organizationId: string,
    dto: CreateExpenseDto,
  ) {
    await this.permissions.assert(user, organizationId, 'expense.manage');

    const amount = money(dto.amount);

    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          organizationId,
          recordedById: user.id,
          category: dto.category ?? ExpenseCategory.OTHER,
          description: dto.description.trim(),
          amount,
          incurredAt: dto.incurredAt
            ? this.checkDate(parseDate(dto.incurredAt, 'incurredAt'))
            : new Date(),
          reference: dto.reference?.trim(),
        },
      });

      await this.audit(tx, user, organizationId, 'CREATE', created.id, {
        amount: amount.toFixed(2),
        category: created.category,
        description: created.description,
      });

      return created;
    });

    await this.notifyFinanceStaff(
      organizationId,
      user.id,
      'CREATED',
      expense,
    );

    return expense;
  }

  async list(
    user: AuthUser,
    organizationId: string,
    filters: {
      category?: ExpenseCategory;
      from?: string;
      to?: string;
    },
  ) {
    await this.permissions.assert(user, organizationId, 'expense.manage');

    const where: Prisma.ExpenseWhereInput = {
      organizationId,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.from || filters.to
        ? {
            incurredAt: {
              ...(filters.from
                ? { gte: parseDate(filters.from, 'from') }
                : {}),
              ...(filters.to
                ? { lt: parseDate(filters.to, 'to') }
                : {}),
            },
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          recordedBy: {
            select: {
              id: true,
              firstName: true,
              otherNames: true,
              lastName: true,
            },
          },
        },
        orderBy: { incurredAt: 'desc' },
        take: 200,
      }),
      this.prisma.expense.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    return {
      total: (total._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      records,
    };
  }

  private async load(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found.');
    }

    return expense;
  }

  async update(user: AuthUser, id: string, dto: UpdateExpenseDto) {
    const expense = await this.load(id);

    await this.permissions.assert(
      user,
      expense.organizationId,
      'expense.manage',
    );

    const data: Prisma.ExpenseUpdateInput = {};
    const changes: Record<string, { from: string; to: string }> = {};

    if (dto.category !== undefined && dto.category !== expense.category) {
      data.category = dto.category;
      changes.category = {
        from: expense.category,
        to: dto.category,
      };
    }

    if (dto.description !== undefined) {
      data.description = dto.description.trim();
      changes.description = {
        from: expense.description,
        to: data.description,
      };
    }

    if (dto.amount !== undefined) {
      const amount = money(dto.amount);

      if (!amount.equals(expense.amount)) {
        data.amount = amount;
        changes.amount = {
          from: expense.amount.toFixed(2),
          to: amount.toFixed(2),
        };
      }
    }

    if (dto.incurredAt !== undefined) {
      data.incurredAt = this.checkDate(
        parseDate(dto.incurredAt, 'incurredAt'),
      );

      changes.incurredAt = {
        from: expense.incurredAt.toISOString(),
        to: data.incurredAt.toISOString(),
      };
    }

    if (dto.reference !== undefined) {
      const reference = dto.reference.trim();

      if (reference !== (expense.reference ?? '')) {
        data.reference = reference;
        changes.reference = {
          from: expense.reference ?? '',
          to: reference,
        };
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.expense.update({
        where: { id },
        data,
      });

      if (Object.keys(changes).length > 0) {
        await this.audit(
          tx,
          user,
          expense.organizationId,
          'UPDATE',
          id,
          { changes },
        );
      }

      return result;
    });

    if (Object.keys(changes).length > 0) {
      await this.notifyFinanceStaff(
        expense.organizationId,
        user.id,
        'UPDATED',
        updated,
        Object.entries(changes).map(
          ([field, change]) =>
            `${field}: "${change.from}" → "${change.to}"`,
        ),
      );
    }

    return updated;
  }

  /** Deleting records needs finance.view (owner or accountant), not just expense.manage. */
  async remove(user: AuthUser, id: string) {
    const expense = await this.load(id);

    await this.permissions.assert(
      user,
      expense.organizationId,
      'finance.view',
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id } });

      await this.audit(
        tx,
        user,
        expense.organizationId,
        'DELETE',
        id,
        {
          amount: expense.amount.toFixed(2),
          category: expense.category,
          description: expense.description,
        },
      );
    });

    await this.notifyFinanceStaff(
      expense.organizationId,
      user.id,
      'DELETED',
      expense,
    );

    if (expense.receiptPublicId) {
      await this.cloudinary
        .deleteAsset(expense.receiptPublicId)
        .catch(() => {
          this.log.error(
            `Could not delete receipt ${expense.receiptPublicId}`,
          );
        });
    }

    return { ok: true };
  }

  async attachReceipt(
    user: AuthUser,
    id: string,
    file: Express.Multer.File,
  ) {
    const expense = await this.load(id);

    await this.permissions.assert(
      user,
      expense.organizationId,
      'expense.manage',
    );

    const uploaded = await this.cloudinary.uploadImage(
      file,
      `neighborhood/receipts/${expense.organizationId}`,
    );

    let updated;

    try {
      updated = await this.prisma.expense.update({
        where: { id },
        data: {
          receiptUrl: uploaded.url,
          receiptPublicId: uploaded.publicId,
        },
      });
    } catch (error) {
      await this.cloudinary.deleteAsset(uploaded.publicId).catch(() => {
        this.log.error(`Orphaned receipt asset ${uploaded.publicId}`);
      });

      throw error;
    }

    if (expense.receiptPublicId) {
      await this.cloudinary
        .deleteAsset(expense.receiptPublicId)
        .catch(() => {
          this.log.error(
            `Could not delete old receipt ${expense.receiptPublicId}`,
          );
        });
    }

    await this.notifyFinanceStaff(
      expense.organizationId,
      user.id,
      'RECEIPT_ATTACHED',
      updated,
    );

    return updated;
  }
}
