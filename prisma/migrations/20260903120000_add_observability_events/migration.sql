-- CreateTable
CREATE TABLE "observability_events" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "auctionId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observability_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observability_events_category_createdAt_idx" ON "observability_events"("category", "createdAt");

-- CreateIndex
CREATE INDEX "observability_events_auctionId_createdAt_idx" ON "observability_events"("auctionId", "createdAt");
