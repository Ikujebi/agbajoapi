/*
  Warnings:

  - Added the required column `updatedAt` to the `EmailCampaign` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('PENDING', 'SENDING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "EmailCampaign" ADD COLUMN     "acceptedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "EmailCampaignStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "EmailCampaign_organizationId_status_idx" ON "EmailCampaign"("organizationId", "status");
