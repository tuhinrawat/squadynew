import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import path from 'path'
import fs from 'fs'
import * as XLSX from 'xlsx'

type ParsedRow = {
  bidderName: string
  playerName: string
  price: number
}

function normalizeName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function tryParsePrice(v: any): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v)
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ]+/g, ''))
    if (isFinite(n)) return Math.round(n)
  }
  return null
}

/**
 * POST /api/debug/clean-and-backfill-from-xlsx
 * Body:
 * {
 *   auctionSlug: string,                 // required, e.g., "assetz-premier-league-2026-1"
 *   filename?: string                    // defaults to "PLayerresult.xlsx" in /public
 * }
 *
 * Steps:
 * 1) Clean auction data:
 *    - Set all players to AVAILABLE, clear soldTo/soldPrice
 *    - Reset bidders.remainingPurse to rules.totalPurse
 *    - Clear auction.bidHistory
 * 2) Parse Excel and backfill SOLD results and bidder purse deductions
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { auctionSlug?: string, filename?: string } | null
  if (!body?.auctionSlug) {
    return NextResponse.json({ error: 'auctionSlug is required' }, { status: 400 })
  }
  const filename = body.filename && body.filename.trim() ? body.filename.trim() : 'PLayerresult.xlsx'
  const filePath = path.join(process.cwd(), 'public', filename)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: `File not found in public: ${filename}` }, { status: 404 })
  }

  // Load auction with minimal fields
  const auction = await prisma.auction.findFirst({
    where: { slug: body.auctionSlug }
  })
  if (!auction) {
    return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
  }

  const rules = (auction.rules as any) || {}
  const totalPurse: number = Number(rules.totalPurse) || 100000

  // Step 1: Clean
  await prisma.$transaction(async (tx) => {
    // Reset players
    await tx.player.updateMany({
      where: { auctionId: auction.id },
      data: { status: 'AVAILABLE', soldTo: null, soldPrice: null }
    })
    // Reset bidders remainingPurse
    await tx.bidder.updateMany({
      where: { auctionId: auction.id },
      data: { remainingPurse: totalPurse }
    })
    // Clear bid history and current player pointer
    await tx.auction.update({
      where: { id: auction.id },
      data: { bidHistory: [] as any, currentPlayerId: null }
    })
  })

  // Step 2: Parse Excel
  const workbook = XLSX.readFile(filePath)
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: true })

  const rows: ParsedRow[] = []
  for (const r of json) {
    const bidderName = r['Bidder'] ?? r['bidder'] ?? r['BIDDER'] ?? r['Team'] ?? r['team'] ?? r['Team Name'] ?? r['team name'] ?? r['TeamName']
    const playerName = r['Player'] ?? r['player'] ?? r['PLAYER'] ?? r['Name'] ?? r['name']
    const priceVal = r['Price'] ?? r['PRICE'] ?? r['price'] ?? r['Amount'] ?? r['amount'] ?? r['Final'] ?? r['final']
    const price = tryParsePrice(priceVal)
    if (bidderName && playerName && price && price > 0) {
      rows.push({ bidderName: String(bidderName).trim(), playerName: String(playerName).trim(), price })
    }
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid rows found in spreadsheet' }, { status: 400 })
  }

  // Fetch players and bidders for mapping
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
    if (n1) bidderNameToInfo.set(n1, { id: b.id, remainingPurse: totalPurse }) // start from reset purse
    if (n2) bidderNameToInfo.set(n2, { id: b.id, remainingPurse: totalPurse })
    if (n3) bidderNameToInfo.set(n3, { id: b.id, remainingPurse: totalPurse })
  }

  const bidderRemaining = new Map<string, number>()
  for (const info of bidderNameToInfo.values()) {
    bidderRemaining.set(info.id, totalPurse)
  }

  const results: Array<{ playerName: string; bidderName: string; price: number; status: 'updated' | 'skipped' | 'error'; reason?: string }> = []
  const soldEvents: Array<{ playerId: string, bidderId: string, amount: number }> = []

  for (const row of rows) {
    const pn = normalizeName(row.playerName)
    const bn = normalizeName(row.bidderName)
    const price = Number(row.price)

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

    const currentRemaining = bidderRemaining.get(bidderInfo.id) ?? totalPurse
    const newRemaining = currentRemaining - price
    if (!Number.isFinite(newRemaining) || newRemaining < 0) {
      results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'error', reason: 'Would make remaining purse negative' })
      continue
    }

    bidderRemaining.set(bidderInfo.id, newRemaining)
    soldEvents.push({ playerId, bidderId: bidderInfo.id, amount: price })
    results.push({ playerName: row.playerName, bidderName: row.bidderName, price, status: 'updated' })
  }

  if (soldEvents.length > 0) {
    await prisma.$transaction(async (tx) => {
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
      // Replace bid history with only the appended sold events
      const appended = soldEvents.map(ev => ({
        type: 'sold',
        playerId: ev.playerId,
        bidderId: ev.bidderId,
        amount: ev.amount,
        timestamp: new Date().toISOString()
      }))
      await tx.auction.update({
        where: { id: auction.id },
        data: { bidHistory: appended as any }
      })
    })
  }

  const summary = {
    parsedRows: rows.length,
    updated: results.filter(r => r.status === 'updated').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length
  }

  return NextResponse.json({
    success: true,
    file: filename,
    auction: { id: auction.id, slug: auction.slug, name: auction.name },
    summary,
    results
  })
}


