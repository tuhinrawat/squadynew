-- CreateTable
CREATE TABLE "auction_links" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "linkedAuctionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_links_linkedAuctionId_idx" ON "auction_links"("linkedAuctionId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_links_auctionId_linkedAuctionId_key" ON "auction_links"("auctionId", "linkedAuctionId");

-- AddForeignKey
ALTER TABLE "auction_links" ADD CONSTRAINT "auction_links_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_links" ADD CONSTRAINT "auction_links_linkedAuctionId_fkey" FOREIGN KEY ("linkedAuctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "players" ADD COLUMN "lastYearPrice" DOUBLE PRECISION,
ADD COLUMN "lastYearTeamName" TEXT,
ADD COLUMN "lastYearBidderName" TEXT,
ADD COLUMN "lastYearAuctionName" TEXT;
