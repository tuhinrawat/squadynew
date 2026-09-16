-- AlterTable
ALTER TABLE "players" ADD COLUMN "serialNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "players_auctionId_serialNumber_key" ON "players"("auctionId", "serialNumber");
