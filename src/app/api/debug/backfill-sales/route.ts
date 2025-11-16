import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

type BackfillRow = {
  bidderName: string
  playerName: string
  price: number
}

function normalizeName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * POST /api/debug/backfill-sales
 * Admin-only utility to backfill SOLD results for an auction from a list of rows.
 * Body:
 * {
 *   auctionSlug: string,
 *   rows: Array<{ bidderName: string, playerName: string, price: number }>
 * }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { auctionSlug?: string, rows?: BackfillRow[] } | null
  if (!body || !body.auctionSlug || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'auctionSlug and rows are required' }, { status: 400 })
  }

  // Load auction with minimal data; we'll fetch players/bidders separately for performance
  const auction = await prisma.auction.findFirst({
    where: { slug: body.auctionSlug }
  })
  if (!auction) {
    return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
  }

  // Fetch players and bidders for name mapping
  const [players, bidders] = await Promise.all([
    prisma.player.findMany({
      where: { auctionId: auction.id },
      select: { id: true, status: true, soldTo: true, soldPrice: true, data: true }
    }),
    prisma.bidder.findMany({
      where: { auctionId: auction.id },
      select: {
        id: true,
        remainingPurse: true,
        teamName: true,
        username: true,
        user: { select: { name: true } }
      }
    })
  ])

  const playerNameToId = new Map<string, string>()
  for (const p of players) {
    const pdata = (p.data as any) || {}
    const name = normalizeName(pdata.name || pdata.Name || '')
    if (name) playerNameToId.set(name, p.id)
  }

  type BidderInfo = { id: string, remainingPurse: number }
  const bidderNameToInfo = new Map<string, BidderInfo>()
  for (const b of bidders) {
    const n1 = normalizeName(b.user?.name || '')
    const n2 = normalizeName(b.teamName || '')
    const n3 = normalizeName(b.username || '')
    if (n1) bidderNameToInfo.set(n1, { id: b.id, remainingPurse: b.remainingPurse })
    if (n2) bidderNameToInfo.set(n2, { id: b.id, remainingPurse: b.remainingPurse })
    if (n3) bidderNameToInfo.set(n3, { id: b.id, remainingPurse: b.remainingPurse })
  }

  // Prepare a mutable copy of remaining purses so we can deduct across multiple rows atomically
  const bidderRemaining = new Map<string, number>()
  for (const [name, info] of bidderNameToInfo.entries()) {
    bidderRemaining.set(info.id, info.remainingPurse)
  }

  const results: Array<{ playerName: string; bidderName: string; price: number; status: 'updated' | 'skipped' | 'error'; reason?: string }> = []
  const soldEvents: any[] = []

  for (const row of body.rows) {
    const pn = normalizeName(row.playerName)
    const bn = normalizeName(row.bidderName)
    const price = Number(row.price)

    if (!pn || !bn || !Number.isFinite(price) || price <= 0) {
      results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'skipped', reason: 'Invalid row data' })
      continue
    }

    const playerId = playerNameToId.get(pn)
    const bidderInfo = bidderNameToInfo.get(bn)
    if (!playerId) {
      results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'error', reason: 'Player not found in auction' })
      continue
    }
    if (!bidderInfo) {
      results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'error', reason: 'Bidder not found in auction' })
      continue
    }

    const currentRemaining = bidderRemaining.get(bidderInfo.id) ?? bidderInfo.remainingPurse
    const newRemaining = currentRemaining - price
    // Allow negative in backfill? We will not allow it by default to keep DB sane.
    if (!Number.isFinite(newRemaining) || newRemaining < 0) {
      results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'error', reason: 'Would make remaining purse negative' })
      continue
    }

    // Queue updates
    bidderRemaining.set(bidderInfo.id, newRemaining)
    soldEvents.push({ playerId, bidderId: bidderInfo.id, amount: price })
    results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'updated' })
  }

  // Apply updates in a transaction
  if (soldEvents.length > 0) {
    await prisma.$transaction(async (tx) => {
      // Update players and bidders
      for (const ev of soldEvents) {
        await tx.player.update({
          where: { id: ev.playerId },
          data: {
            status: 'SOLD',
            soldTo: ev.bidderId,
            soldPrice: ev.amount
          }
        })
      }
      // Batch bidder purse updates
      const uniqueBidderIds = Array.from(new Set(soldEvents.map(e => e.bidderId)))
      for (const bidderId of uniqueBidderIds) {
        const r = bidderRemaining.get(bidderId)
        if (typeof r === 'number') {
          await tx.bidder.update({
            where: { id: bidderId },
            data: { remainingPurse: r }
          })
        }
      }

      // Append sold events to bid history for minimal auditability
      const auctionRef = await tx.auction.findUnique({
        where: { id: auction.id },
        select: { bidHistory: true }
      })
      const existingHistory = (auctionRef?.bidHistory as any[]) || []
      const appended = soldEvents.map(ev => ({
        type: 'sold',
        playerId: ev.playerId,
        bidderId: ev.bidderId,
        amount: ev.amount,
        timestamp: new Date().toISOString()
      }))
      const updatedHistory = [...appended, ...existingHistory]
      await tx.auction.update({
        where: { id: auction.id },
        data: { bidHistory: updatedHistory as any }
      })
    })
  }

  const summary = {
    totalRows: body.rows.length,
    updated: results.filter(r => r.status === 'updated').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length
  }

  return NextResponse.json({ success: true, auction: { id: auction.id, slug: auction.slug, name: auction.name }, summary, results })
}


