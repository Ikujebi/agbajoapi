-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('TOPUP', 'SMS_CHARGE', 'SMS_REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SmsCampaignStatus" AS ENUM ('SENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ORDER', 'WALLET_FUNDING', 'WALLET_WITHDRAWAL', 'WALLET_TRANSFER', 'SERVICE_BOOKING', 'SERVICE_FEE', 'VISITOR_PASS', 'ESTATE_DUES', 'ESTATE_LEVY', 'RENT', 'UTILITY_BILL', 'MAINTENANCE', 'SECURITY_FEE', 'EVENT_TICKET', 'EVENT_REGISTRATION', 'CHURCH_GIVING', 'CHURCH_PLEDGE', 'DONATION', 'MARKETPLACE_PURCHASE', 'MARKETPLACE_COMMISSION', 'DELIVERY_FEE', 'SUBSCRIPTION', 'SMS_CREDITS', 'EMAIL_CREDITS', 'ADVERTISING', 'LISTING_FEE', 'BOOKING_DEPOSIT', 'REFUND', 'OTHER');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'ORDER';

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "segments" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "refunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SmsCampaignStatus" NOT NULL DEFAULT 'SENDING',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SmsCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_organizationId_key" ON "Wallet"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_reference_key" ON "WalletTransaction"("reference");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsCampaign_organizationId_createdAt_idx" ON "SmsCampaign"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsCampaign_organizationId_idempotencyKey_key" ON "SmsCampaign"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsCampaign" ADD CONSTRAINT "SmsCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsCampaign" ADD CONSTRAINT "SmsCampaign_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
