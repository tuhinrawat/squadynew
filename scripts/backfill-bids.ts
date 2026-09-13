import { config as loadEnv } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

// tsx does not auto-load .env the way Next.js does - load it explicitly the
// same way the repo's other standalone scripts do, preferring .env.local.
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

// One-time backfill for the Bid table (see
// prisma/migrations/20260913120000_add_bids_table).
//
// Context: bids have always lived ONLY inside each Auction's bidHistory JSON
// blob. The new Bid table is populated going forward by the bid route, but
// starts empty for auctions that already have history. This script ports
// those historical bids into the Bid table so the table is complete from day
// one - important before any future migration that moves READS onto it.
//
// This does NOT touch bidHistory: the JSON stays exactly as-is and remains the
// source of truth every reader uses. Nothing is lost or rewritten; this only
// ADDS rows to the (otherwise empty) Bid table. Bids in the JSON stay readable
// whether or not this ever runs.
//
// What it ports: only genuine bid entries. bidHistory also holds 'sold' and
// 'unsold' event markers and (transiently) 'bid-undo' entries - those are
// deliberately left in the JSON only, matching how the bid route writes the
// Bid table (type 'bid' rows for live bids). An undone bid was spliced out of
// the JSON at undo time, so it isn't present to port - consistent with the DB.
//
// FK safety: a legacy bid may reference a player or bidder that has since been
// deleted. Such an insert would violate the Bid table's foreign keys, so those
// entries are skipped (and counted), rather than aborting the whole auction.
//
// Idempotent: an auction that already has any Bid rows is skipped, so a second
// run is a no-op. To re-port a single auction from scratch, delete its bids
// first (DELETE FROM bids WHERE "auctionId" = '...').

type RawBid = {
  bidderId?: unknown
  amount?: unknown
  timestamp?: unknown
  playerId?: unknown
  type?: unknown
}

function toDate(value: unknown): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

async function backfillBids() {
  const auctions = await prisma.auction.findMany({
    select: { id: true, name: true, bidHistory: true },
  })

  let auctionsPorted = 0
  let auctionsSkipped = 0
  let bidsInserted = 0
  let bidsSkippedMissingRef = 0
  let bidsSkippedMalformed = 0

  for (const auction of auctions) {
    const raw = auction.bidHistory
    const history: RawBid[] = Array.isArray(raw) ? (raw as RawBid[]) : []
    if (history.length === 0) continue

    // Idempotency: never double-insert. If this auction already has any Bid
    // rows (from a prior run, or from live bidding after the migration), skip.
    const existing = await prisma.bid.count({ where: { auctionId: auction.id } })
    if (existing > 0) {
      auctionsSkipped++
      continue
    }

    // Valid FK targets for this auction, so we can skip entries whose player
    // or bidder no longer exists instead of failing the insert.
    const [players, bidders] = await Promise.all([
      prisma.player.findMany({ where: { auctionId: auction.id }, select: { id: true } }),
      prisma.bidder.findMany({ where: { auctionId: auction.id }, select: { id: true } }),
    ])
    const playerIds = new Set(players.map(p => p.id))
    const bidderIds = new Set(bidders.map(b => b.id))

    const rows: { auctionId: string; playerId: string; bidderId: string; amount: number; type: string; createdAt: Date }[] = []

    for (const entry of history) {
      // Only genuine bids - skip sold/unsold/bid-undo event markers.
      if (entry.type === 'sold' || entry.type === 'unsold' || entry.type === 'bid-undo') continue

      const playerId = typeof entry.playerId === 'string' ? entry.playerId : null
      const bidderId = typeof entry.bidderId === 'string' ? entry.bidderId : null
      const amount = typeof entry.amount === 'number' ? entry.amount : null

      if (!playerId || !bidderId || amount === null || Number.isNaN(amount)) {
        bidsSkippedMalformed++
        continue
      }
      if (!playerIds.has(playerId) || !bidderIds.has(bidderId)) {
        bidsSkippedMissingRef++
        continue
      }

      rows.push({
        auctionId: auction.id,
        playerId,
        bidderId,
        amount,
        type: 'bid',
        createdAt: toDate(entry.timestamp), // preserve the original bid time
      })
    }

    if (rows.length > 0) {
      const result = await prisma.bid.createMany({ data: rows })
      bidsInserted += result.count
      auctionsPorted++
      console.log(`  ${auction.name} (${auction.id}): ported ${result.count} bid(s)`)
    }
  }

  console.log('\n--- Backfill summary ---')
  console.log(`Auctions scanned:            ${auctions.length}`)
  console.log(`Auctions ported:             ${auctionsPorted}`)
  console.log(`Auctions skipped (had bids): ${auctionsSkipped}`)
  console.log(`Bids inserted:               ${bidsInserted}`)
  console.log(`Bids skipped (missing FK):   ${bidsSkippedMissingRef}`)
  console.log(`Bids skipped (malformed):    ${bidsSkippedMalformed}`)
}

backfillBids()
  .then(() => {
    console.log('Done.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Backfill failed:', error)
    process.exit(1)
  })
