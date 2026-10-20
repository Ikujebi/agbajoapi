/*
  Warnings:

  - The values [ORG_OWNER,ORG_ADMIN] on the enum `MembershipRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `attachmentType` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `attachmentUrl` on the `Message` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "HoursKind" AS ENUM ('OPENING', 'VISITING');

-- AlterEnum
BEGIN;
CREATE TYPE "MembershipRole_new" AS ENUM ('OWNER', 'CHAIRMAN', 'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SECURITY', 'RESIDENT', 'ATTENDANT', 'MEMBER', 'RIDER', 'STAFF', 'ACCOUNTANT', 'MODERATOR');
ALTER TABLE "public"."Membership" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MembershipRole_new" USING ("role"::text::"MembershipRole_new");
ALTER TYPE "MembershipRole" RENAME TO "MembershipRole_old";
ALTER TYPE "MembershipRole_new" RENAME TO "MembershipRole";
DROP TYPE "public"."MembershipRole_old";
ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
COMMIT;

-- DropIndex
DROP INDEX "Message_conversationId_createdAt_idx";

-- DropIndex
DROP INDEX "Message_senderId_createdAt_idx";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "attachmentType",
DROP COLUMN "attachmentUrl",
ADD COLUMN     "isEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaFileName" TEXT,
ADD COLUMN     "mediaMimeType" TEXT,
ADD COLUMN     "mediaPublicId" TEXT,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "type" "MessageType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "body" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos';

-- CreateTable
CREATE TABLE "OrganizationHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "HoursKind" NOT NULL DEFAULT 'OPENING',
    "dayOfWeek" INTEGER NOT NULL,
    "opensAt" TEXT NOT NULL,
    "closesAt" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrganizationHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationHours_organizationId_kind_idx" ON "OrganizationHours"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationHours_organizationId_kind_dayOfWeek_key" ON "OrganizationHours"("organizationId", "kind", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "OrganizationHours" ADD CONSTRAINT "OrganizationHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
