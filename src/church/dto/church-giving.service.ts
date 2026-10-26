import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GivingType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ChurchAccessService } from '../church-access.service';
import { CreatePledgeDto, RecordGivingDto } from './church.dto';

type Tx = Prisma.TransactionClient;

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

@Injectable()
export class ChurchGivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly access: ChurchAccessService,
  ) {}

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is not a valid date.`);
    }

    return date;
  }

  /** Adds a payment to a pledge and moves it to PARTIALLY_PAID or FULFILLED. */
  private async applyToPledge(
    tx: Tx,
    pledgeId: string,
    organizationId: string,
    churchMemberId: string,
    amount: Prisma.Decimal,
  ) {
    const pledge = await tx.pledge.findFirst({
      where: { id: pledgeId, organizationId, churchMemberId },
    });

    if (!pledge) {
      throw new NotFoundException('Pledge not found for this member.');
    }

    if (pledge.status === 'CANCELLED' || pledge.status === 'FULFILLED') {
      throw new BadRequestException('This pledge is already closed.');
    }

    const paid = pledge.amountPaid.add(amount);

    await tx.pledge.update({
      where: { id: pledge.id },
      data: {
        amountPaid: paid,
        status: paid.gte(pledge.targetAmount) ? 'FULFILLED' : 'PARTIALLY_PAID',
      },
    });
  }

  // ---------- giving ----------

  /** For cash, cheques and transfers an admin records by hand. */
  async record(user: AuthUser, organizationId: string, dto: RecordGivingDto) {
    await this.access.assertWorship(organizationId);
    await this.permissions.assert(user, organizationId, 'giving.manage');

    const amount = money(dto.amount);
    let churchMemberId: string | null = null;

    if (dto.userId) {
      if (!(await this.access.isApprovedMember(dto.userId, organizationId))) {
        throw new BadRequestException(
          'That person is not an approved member of this organization.',
        );
      }

      churchMemberId = (
        await this.access.ensureMember(dto.userId, organizationId)
      ).id;
    }

    if (dto.pledgeId && !churchMemberId) {
      throw new BadRequestException('A pledge payment must name the member.');
    }

    const receivedAt = dto.receivedAt
      ? this.parseDate(dto.receivedAt, 'receivedAt')
      : new Date();

    if (receivedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('receivedAt cannot be in the future.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await tx.givingRecord.create({
          data: {
            organizationId,
            churchMemberId,
            type: dto.pledgeId ? GivingType.PLEDGE : dto.type,
            amount,
            reference: dto.reference,
            isAnonymous: dto.isAnonymous ?? false,
            notes: dto.notes?.trim(),
            receivedAt,
          },
        });

        if (dto.pledgeId && churchMemberId) {
          await this.applyToPledge(
            tx,
            dto.pledgeId,
            organizationId,
            churchMemberId,
            amount,
          );
        }

        return record;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A giving record with this reference already exists.',
        );
      }

      throw error;
    }
  }

  /** A member's own giving history, for their tax or personal records. */
  async mine(user: AuthUser, organizationId: string) {
    await this.access.assertMember(user, organizationId);

    const member = await this.prisma.churchMember.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      select: { id: true },
    });

    if (!member) {
      return { total: '0.00', records: [] };
    }

    const [records, total] = await Promise.all([
      this.prisma.givingRecord.findMany({
        where: { organizationId, churchMemberId: member.id },
        orderBy: { receivedAt: 'desc' },
        take: 100,
      }),
      this.prisma.givingRecord.aggregate({
        where: { organizationId, churchMemberId: member.id },
        _sum: { amount: true },
      }),
    ]);

    return {
      total: (total._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      records,
    };
  }

  /** Admin list. Anonymous gifts never show who gave. */
  async list(
    user: AuthUser,
    organizationId: string,
    filters: { from?: string; to?: string; type?: GivingType },
  ) {
    await this.permissions.assert(user, organizationId, 'giving.manage');

    const records = await this.prisma.givingRecord.findMany({
      where: {
        organizationId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.from || filters.to
          ? {
              receivedAt: {
                ...(filters.from
                  ? { gte: this.parseDate(filters.from, 'from') }
                  : {}),
                ...(filters.to ? { lt: this.parseDate(filters.to, 'to') } : {}),
              },
            }
          : {}),
      },
      include: {
        churchMember: {
          select: { user: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });

    return records.map(({ churchMember, ...record }) => ({
      ...record,
      member: record.isAnonymous ? null : (churchMember?.user ?? null),
    }));
  }

  /** Totals by type and by month. Defaults to the last 12 months. */
  async summary(
    user: AuthUser,
    organizationId: string,
    from?: string,
    to?: string,
  ) {
    await this.permissions.assert(user, organizationId, 'giving.manage');

    const end = to
      ? this.parseDate(to, 'to')
      : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const start = from
      ? this.parseDate(from, 'from')
      : new Date(end.getFullYear() - 1, end.getMonth(), 1);

    const where = {
      organizationId,
      receivedAt: { gte: start, lt: end },
    };

    const [byType, overall, byMonth] = await Promise.all([
      this.prisma.givingRecord.groupBy({
        by: ['type'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.givingRecord.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
        SELECT date_trunc('month', "receivedAt") AS month, SUM("amount") AS total
        FROM "GivingRecord"
        WHERE "organizationId" = ${organizationId}
          AND "receivedAt" >= ${start} AND "receivedAt" < ${end}
        GROUP BY 1
        ORDER BY 1`,
    ]);

    return {
      from: start,
      to: end,
      total: (overall._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      count: overall._count,
      byType: byType.map((row) => ({
        type: row.type,
        total: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: row._count,
      })),
      byMonth: byMonth.map((row) => ({
        month: row.month,
        total: new Prisma.Decimal(row.total).toFixed(2),
      })),
    };
  }

  // ---------- pledges ----------

  async createPledge(user: AuthUser, organizationId: string, dto: CreatePledgeDto) {
    await this.access.assertWorship(organizationId);

    const forSomeoneElse = !!dto.userId && dto.userId !== user.id;
    const targetUserId = forSomeoneElse ? dto.userId! : user.id;

    if (forSomeoneElse) {
      await this.permissions.assert(user, organizationId, 'giving.manage');
    }

    if (!(await this.access.isApprovedMember(targetUserId, organizationId))) {
      throw new BadRequestException(
        'Only approved members of this organization can make a pledge.',
      );
    }

    const member = await this.access.ensureMember(targetUserId, organizationId);

    return this.prisma.pledge.create({
      data: {
        organizationId,
        churchMemberId: member.id,
        title: dto.title.trim(),
        targetAmount: money(dto.targetAmount),
        dueAt: dto.dueAt ? this.parseDate(dto.dueAt, 'dueAt') : undefined,
      },
    });
  }

  async myPledges(user: AuthUser, organizationId: string) {
    await this.access.assertMember(user, organizationId);

    return this.prisma.pledge.findMany({
      where: { organizationId, churchMember: { userId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listPledges(user: AuthUser, organizationId: string) {
    await this.permissions.assert(user, organizationId, 'giving.manage');

    return this.prisma.pledge.findMany({
      where: { organizationId },
      include: {
        churchMember: {
          select: { user: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async cancelPledge(user: AuthUser, id: string) {
    const pledge = await this.prisma.pledge.findUnique({
      where: { id },
      include: { churchMember: { select: { userId: true } } },
    });

    if (!pledge) {
      throw new NotFoundException('Pledge not found.');
    }

    const isOwner = pledge.churchMember?.userId === user.id;

    if (
      !isOwner &&
      !(await this.permissions.can(user, pledge.organizationId, 'giving.manage'))
    ) {
      throw new ForbiddenException('You do not have permission to do this');
    }

    if (pledge.status !== 'OPEN' && pledge.status !== 'PARTIALLY_PAID') {
      throw new BadRequestException('This pledge is already closed.');
    }

    return this.prisma.pledge.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }
}
