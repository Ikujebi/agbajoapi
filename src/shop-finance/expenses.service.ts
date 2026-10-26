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
import { AuthUser } from '../common/decorators/current-user.decorator';
import { parseDate } from '../common/utils/dates';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

type Tx = Prisma.TransactionClient;

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

@Injectable()
export class ExpensesService {
  private readonly log = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly cloudinary: CloudinaryService,
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

  async create(user: AuthUser, organizationId: string, dto: CreateExpenseDto) {
    await this.permissions.assert(user, organizationId, 'expense.manage');

    const amount = money(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
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

      await this.audit(tx, user, organizationId, 'CREATE', expense.id, {
        amount: amount.toFixed(2),
        category: expense.category,
        description: expense.description,
      });

      return expense;
    });
  }

  async list(
    user: AuthUser,
    organizationId: string,
    filters: { category?: ExpenseCategory; from?: string; to?: string },
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
              ...(filters.to ? { lt: parseDate(filters.to, 'to') } : {}),
            },
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: { recordedBy: { select: { id: true, fullName: true } } },
        orderBy: { incurredAt: 'desc' },
        take: 200,
      }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      total: (total._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      records,
    };
  }

  private async load(id: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });

    if (!expense) {
      throw new NotFoundException('Expense not found.');
    }

    return expense;
  }

  async update(user: AuthUser, id: string, dto: UpdateExpenseDto) {
    const expense = await this.load(id);

    await this.permissions.assert(user, expense.organizationId, 'expense.manage');

    const data: Prisma.ExpenseUpdateInput = {};
    const changes: Record<string, { from: string; to: string }> = {};

    if (dto.category !== undefined && dto.category !== expense.category) {
      data.category = dto.category;
      changes.category = { from: expense.category, to: dto.category };
    }

    if (dto.description !== undefined) {
      data.description = dto.description.trim();
      changes.description = { from: expense.description, to: data.description };
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
      data.incurredAt = this.checkDate(parseDate(dto.incurredAt, 'incurredAt'));
      changes.incurredAt = {
        from: expense.incurredAt.toISOString(),
        to: data.incurredAt.toISOString(),
      };
    }

    if (dto.reference !== undefined) {
      data.reference = dto.reference.trim();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({ where: { id }, data });

      if (Object.keys(changes).length > 0) {
        await this.audit(tx, user, expense.organizationId, 'UPDATE', id, {
          changes,
        });
      }

      return updated;
    });
  }

  /** Deleting records needs finance.view (owner or accountant), not just expense.manage. */
  async remove(user: AuthUser, id: string) {
    const expense = await this.load(id);

    await this.permissions.assert(user, expense.organizationId, 'finance.view');

    await this.prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id } });

      await this.audit(tx, user, expense.organizationId, 'DELETE', id, {
        amount: expense.amount.toFixed(2),
        category: expense.category,
        description: expense.description,
      });
    });

    if (expense.receiptPublicId) {
      await this.cloudinary.deleteAsset(expense.receiptPublicId).catch(() => {
        this.log.error(`Could not delete receipt ${expense.receiptPublicId}`);
      });
    }

    return { ok: true };
  }

  async attachReceipt(user: AuthUser, id: string, file: Express.Multer.File) {
    const expense = await this.load(id);

    await this.permissions.assert(user, expense.organizationId, 'expense.manage');

    const uploaded = await this.cloudinary.uploadImage(
      file,
      `neighborhood/receipts/${expense.organizationId}`,
    );

    let updated;

    try {
      updated = await this.prisma.expense.update({
        where: { id },
        data: { receiptUrl: uploaded.url, receiptPublicId: uploaded.publicId },
      });
    } catch (error) {
      await this.cloudinary.deleteAsset(uploaded.publicId).catch(() => {
        this.log.error(`Orphaned receipt asset ${uploaded.publicId}`);
      });

      throw error;
    }

    // Replace: remove the previous receipt only after the new one is saved.
    if (expense.receiptPublicId) {
      await this.cloudinary.deleteAsset(expense.receiptPublicId).catch(() => {
        this.log.error(`Could not delete old receipt ${expense.receiptPublicId}`);
      });
    }

    return updated;
  }
}
