import { config as loadEnv } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

// tsx does not auto-load .env the way Next.js does - load it explicitly
// the same way the repo's other standalone scripts do (see wipe-db.ts),
// preferring .env.local if present.
;(() => {
  const root = process.cwd()
  const envLocal = resolve(root, '.env.local')
  const envFile = resolve(root, '.env')
  if (existsSync(envLocal)) {
    loadEnv({ path: envLocal })
  } else if (existsSync(envFile)) {
    loadEnv({ path: envFile })
  } else {
    loadEnv()
  }
})()

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// One-time backfill for the soldAt migration (see
// prisma/migrations/20260911120000_add_player_sold_at). Any player marked
// SOLD before that field existed has soldAt = null, which the public
// view's sold ticker deliberately excludes rather than guess at - this
// script fills those in using each player's own createdAt (import time) as
// the best available real value, since nothing else in this app ever
// recorded when a player was actually sold (checked: no successful-bid or
// successful-sale event is logged anywhere, and Auction.bidHistory resets
// every time the current player changes).
//
// Caveat, worth knowing before you run this: createdAt is import order,
// not sale order - this app draws the next player at random (icon players
// first, then everyone else), so import order does not reliably predict
// the order players were actually sold in. This is a real, non-invented
// timestamp, not a guess pulled from nowhere - but it is still only an
// approximation for anything sold before soldAt existed. Anything sold
// AFTER this script runs already gets a correct, real soldAt from
// mark-sold/reconcile-offline - this only touches the historical gap.
//
// Safe to re-run: only touches rows where soldAt is still null, so running
// it twice is a no-op the second time.
async function backfillSoldAt() {
  const result = await prisma.$executeRaw`
    UPDATE "players"
    SET "soldAt" = "createdAt"
    WHERE "status" = 'SOLD' AND "soldAt" IS NULL
  `
  console.log(`Backfilled soldAt for ${result} player(s).`)
}

backfillSoldAt()
  .then(() => {
    console.log('Done.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Backfill failed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
