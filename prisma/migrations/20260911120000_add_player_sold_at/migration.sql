-- AlterTable
ALTER TABLE "players" ADD COLUMN "soldAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "players_auctionId_status_soldAt_idx" ON "players"("auctionId", "status", "soldAt");
