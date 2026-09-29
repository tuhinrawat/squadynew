-- AlterTable: add the column nullable first so the backfill below can target it
ALTER TABLE "auctions" ADD COLUMN "syncKey" TEXT;

-- Backfill: every auction that doesn't have one yet gets a random key -
-- this deliberately covers every existing auction (live ones and old ones
-- alike), not just currently-LIVE ones, since a key sitting unused on a
-- completed auction is harmless and this avoids leaving ambiguity about
-- which past auctions are "close enough to live" to matter.
UPDATE "auctions" SET "syncKey" = gen_random_uuid()::text WHERE "syncKey" IS NULL;

-- Every future INSERT gets one automatically from here on, so this backfill
-- is a one-time fix, not something that needs re-running.
ALTER TABLE "auctions" ALTER COLUMN "syncKey" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "auctions" ALTER COLUMN "syncKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "auctions_syncKey_key" ON "auctions"("syncKey");
