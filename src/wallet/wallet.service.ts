import { Injectable } from '@nestjs/common';
import { Prisma, WalletTxType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

type Tx = Prisma.TransactionClient;

/**
 * Prepaid balance per organization, in naira.
 *
 * credit() and debit() must run inside a transaction. They lock the wallet
 * row first, so two concurrent charges can never spend the same money and
 * every ledger row records the true balance after it.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async lock(tx: Tx, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "Wallet" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
  }

  async credit(
    tx: Tx,
    organizationId: string,
    amount: Prisma.Decimal,
    type: WalletTxType,
    description: string,
    reference?: string,
  ) {
    await tx.wallet.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });

    await this.lock(tx, organizationId);

    const wallet = await tx.wallet.update({
      where: { organizationId },
      data: { balance: { increment: amount } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        amount,
        balanceAfter: wallet.balance,
        description,
        reference,
      },
    });

    return wallet;
  }

  /** Returns the updated wallet, or null if the balance is too low. */
  async debit(
    tx: Tx,
    organizationId: string,
    amount: Prisma.Decimal,
    type: WalletTxType,
    description: string,
    reference?: string,
  ) {
    await this.lock(tx, organizationId);

    const claimed = await tx.wallet.updateMany({
      where: { organizationId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });

    if (claimed.count !== 1) return null;

    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { organizationId },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        amount: amount.neg(),
        balanceAfter: wallet.balance,
        description,
        reference,
      },
    });

    return wallet;
  }

  async balance(organizationId: string): Promise<Prisma.Decimal> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { organizationId },
      select: { balance: true },
    });

    return wallet?.balance ?? new Prisma.Decimal(0);
  }

  async overview(user: AuthUser, organizationId: string) {
    await this.permissions.assert(user, organizationId, 'wallet.manage');

    const wallet = await this.prisma.wallet.findUnique({
      where: { organizationId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    return {
      balance: (wallet?.balance ?? new Prisma.Decimal(0)).toFixed(2),
      currency: wallet?.currency ?? 'NGN',
      transactions: wallet?.transactions ?? [],
    };
  }
}
