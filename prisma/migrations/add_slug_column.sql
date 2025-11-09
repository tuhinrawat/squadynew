-- Add slug column to auctions table
-- This migration adds a URL-friendly slug field for professional shareable URLs

-- Add the slug column (nullable for backward compatibility)
ALTER TABLE "auctions" ADD COLUMN "slug" TEXT;

-- Create a unique index on slug
CREATE UNIQUE INDEX "auctions_slug_key" ON "auctions"("slug");

-- Create a regular index for faster lookups
CREATE INDEX "auctions_slug_idx" ON "auctions"("slug");

-- Optional: Generate slugs for existing auctions based on their names
-- Uncomment the following if you want to auto-generate slugs for existing data
-- UPDATE "auctions" SET "slug" = LOWER(
--   REGEXP_REPLACE(
--     REGEXP_REPLACE(
--       REGEXP_REPLACE(name, '[^a-zA-Z0-9\s-]', '', 'g'),
--       '[\s_]+', '-', 'g'
--     ),
--     '-+', '-', 'g'
--   )
-- ) WHERE "slug" IS NULL;

