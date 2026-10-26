-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'GIVING';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "metadata" JSONB;
