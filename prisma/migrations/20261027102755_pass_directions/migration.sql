-- AlterTable
ALTER TABLE "EstateUnit" ADD COLUMN     "directions" TEXT,
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "routeGeoJson" JSONB;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "unitCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "VisitorPass" ADD COLUMN     "destinationUnitId" TEXT,
ADD COLUMN     "shareDirections" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "VisitorPass_destinationUnitId_idx" ON "VisitorPass"("destinationUnitId");

-- AddForeignKey
ALTER TABLE "VisitorPass" ADD CONSTRAINT "VisitorPass_destinationUnitId_fkey" FOREIGN KEY ("destinationUnitId") REFERENCES "EstateUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
