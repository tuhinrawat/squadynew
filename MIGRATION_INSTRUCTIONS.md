# Database Migration Instructions - Add Slug Field

## Quick Fix

Run this command in your terminal to apply the migration:

```bash
# Option 1: Using psql (if you have direct database access)
psql $DATABASE_URL -f prisma/migrations/add_slug_column.sql

# Option 2: Using Prisma migrate (recommended)
npx prisma migrate dev --name add_auction_slug
```

## Manual Migration (If you need to run SQL directly)

Connect to your PostgreSQL database and run:

```sql
-- Add slug column to auctions table
ALTER TABLE "auctions" ADD COLUMN "slug" TEXT;

-- Create unique index on slug
CREATE UNIQUE INDEX "auctions_slug_key" ON "auctions"("slug");

-- Create regular index for faster lookups
CREATE INDEX "auctions_slug_idx" ON "auctions"("slug");
```

## Verify Migration

After running the migration, verify it worked:

```bash
# Check if the column exists
npx prisma db pull
npx prisma generate
```

## What This Does

- Adds a `slug` column to the `auctions` table
- Creates a unique index to ensure no duplicate slugs
- Adds a regular index for fast lookups
- Existing auctions will have `NULL` slugs (backward compatible)
- New auctions will automatically get slugs generated from their names

## Rollback (If Needed)

To remove the slug column:

```sql
DROP INDEX IF EXISTS "auctions_slug_idx";
DROP INDEX IF EXISTS "auctions_slug_key";
ALTER TABLE "auctions" DROP COLUMN "slug";
```

## Next Steps

After migration:
1. Restart your development server
2. Create a new auction - it will have a slug automatically
3. Existing auctions will continue to work with ID URLs
4. Edit existing auction names to generate slugs for them

