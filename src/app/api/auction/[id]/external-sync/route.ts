import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { logEventAsync, describeError } from '@/lib/observability'

// Applies sold results pushed by an admin's own standalone offline tool
// (squady_turbo.html-style consoles) - as opposed to reconcile-offline/
// route.ts, which is the built-in offline console at
// src/app/auction/[id]/offline and authenticates with the admin's login
// session. A standalone tool has no Squady session and no knowledge of
// Squady's internal player/bidder IDs, so this route authenticates with the
// auction's own syncKey (a bearer token, like any other API key) and
// resolves identity from what an external tool actually has: a player's
// serialNumber (exact and unique per auction - see the
// @@unique([auctionId, serialNumber]) constraint on Player) and a bidder's
// name (resolved against this auction's own short bidder list).
//
// Deliberately scoped to SOLD results only. "Unsold" is a transient,
// self-recycling state in every auction console this codebase has (see
// mark-sold/route.ts and reconcile-offline/route.ts's own recycle logic) -
// a player who didn't sell in one pass just comes back around for another,
// so there's nothing durable to sync for it. A player this route has never
// heard about simply stays AVAILABLE on Squady's side, which is already
// correct.

const resultSchema = z.object({
  serialNumber: z.number().int().positive(),
  bidderName: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
})

const requestSchema = z.object({
  results: z.array(resultSchema).max(500),
  // Whoever the offline tool is currently showing, by serial number - null
  // means its pool is empty. Omit entirely to leave Squady's own
  // current-player pointer to the auto-advance fallback below instead of
  // being told explicitly.
  currentSerialNumber: z.number().int().positive().nullable().optional(),
}).refine(data => data.results.length > 0 || data.currentSerialNumber !== undefined, {
  message: 'Provide at least one result or a current-player update'
})

type Outcome = 'applied' | 'applied_with_warning' | 'skipped' | 'conflict' | 'error'

interface ResultOutcome {
  serialNumber: number
  outcome: Outcome
  message?: string
}

const normalize = (s: string) => s.trim().toLowerCase()

// Every response on this route (including the preflight) needs these -
// unlike every other API route here, the caller is a page on a different
// origin entirely (a local file, or wherever the admin's own tool is
// hosted), not a same-origin fetch from squadynew's own client code.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, syncKey: true, currentPlayerId: true, bidHistory: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404, headers: CORS_HEADERS })
    }

    // Constant-time-ish is unnecessary here (this isn't a password hash
    // comparison at login-attempt scale) - a mismatched long random token
    // simply doesn't match, the same way any other API key check works.
    if (!token || token !== auction.syncKey) {
      return NextResponse.json({ error: 'Invalid or missing sync key' }, { status: 401, headers: CORS_HEADERS })
    }

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid sync payload' }, { status: 400, headers: CORS_HEADERS })
    }

    // Fetched once purely to resolve each result's bidderName to an id -
    // this auction's bidder list is small, so matching identity against one
    // prefetched array avoids a query per result. remainingPurse is NOT
    // read from this snapshot, though: it's re-fetched fresh per result
    // below, since a batch can carry more than one sold result for the
    // same bidder and each one needs to see the previous one's deduction.
    const bidders = await prisma.bidder.findMany({
      where: { auctionId: params.id },
      include: { user: { select: { name: true } } }
    })
    const findBidder = (name: string) => {
      const target = normalize(name)
      const matches = bidders.filter(b => normalize(b.user?.name || b.username) === target)
      return matches.length === 1 ? matches[0] : null
    }

    let bidHistory: Record<string, unknown>[] = Array.isArray(auction.bidHistory)
      ? (auction.bidHistory as Record<string, unknown>[])
      : []
    const outcomes: ResultOutcome[] = []
    const changedPlayers: Array<{ id: string; status: string; soldTo: string | null; soldPrice: number | null }> = []
    const bidderPurseAfter = new Map<string, number>()

    // Sequential on purpose - see reconcile-offline/route.ts for the same
    // reasoning: two results for the same bidder must not read-then-write
    // remainingPurse concurrently.
    for (const result of parsed.data.results) {
      const player = await prisma.player.findFirst({
        where: { auctionId: params.id, serialNumber: result.serialNumber },
        select: { id: true, status: true, soldTo: true, soldPrice: true, data: true }
      })
      if (!player) {
        outcomes.push({ serialNumber: result.serialNumber, outcome: 'error', message: `No player with serial number #${result.serialNumber} in this auction.` })
        continue
      }

      const playerData = player.data as Record<string, unknown> | null
      const playerName = (playerData?.name as string) || (playerData?.Name as string) || 'Player'

      const matchedBidder = findBidder(result.bidderName)
      if (!matchedBidder) {
        outcomes.push({
          serialNumber: result.serialNumber,
          outcome: 'conflict',
          message: `No single confident match for bidder "${result.bidderName}" among this auction's bidders - resolve manually.`
        })
        continue
      }

      // Re-fetched fresh here rather than reused from the `bidders` array
      // prefetched above - a batch commonly carries multiple sold results
      // for the same bidder, and remainingPurse must reflect every earlier
      // deduction already applied THIS batch, not the one-time snapshot
      // from before the loop started. Mirrors reconcile-offline/route.ts's
      // own per-result re-fetch for the identical reason.
      const bidder = await prisma.bidder.findUnique({
        where: { id: matchedBidder.id },
        include: { user: { select: { name: true } } }
      })
      if (!bidder) {
        outcomes.push({ serialNumber: result.serialNumber, outcome: 'error', message: 'Bidder no longer exists.' })
        continue
      }

      const alreadyMatches = player.status === 'SOLD' && player.soldTo === bidder.id && player.soldPrice === result.amount
      if (alreadyMatches) {
        outcomes.push({ serialNumber: result.serialNumber, outcome: 'skipped', message: 'Already recorded' })
        continue
      }

      const hasConflictingOutcome = player.status === 'SOLD' || player.status === 'UNSOLD'
      if (hasConflictingOutcome) {
        outcomes.push({
          serialNumber: result.serialNumber,
          outcome: 'conflict',
          message: `${playerName} is already recorded as ${player.status} in the live auction - resolve manually before re-applying.`
        })
        continue
      }

      const newRemainingPurse = bidder.remainingPurse - result.amount
      const insufficientFunds = newRemainingPurse < 0

      await prisma.$transaction([
        prisma.player.update({
          where: { id: player.id },
          data: { status: 'SOLD', soldTo: bidder.id, soldPrice: result.amount, soldAt: new Date() }
        }),
        prisma.bidder.update({
          where: { id: bidder.id },
          data: { remainingPurse: newRemainingPurse }
        })
      ])

      bidHistory = [{
        type: 'sold',
        playerId: player.id,
        playerName,
        bidderId: bidder.id,
        bidderName: bidder.user?.name || bidder.username,
        teamName: bidder.teamName,
        amount: result.amount,
        timestamp: new Date().toISOString()
      }, ...bidHistory]
      changedPlayers.push({ id: player.id, status: 'SOLD', soldTo: bidder.id, soldPrice: result.amount })
      bidderPurseAfter.set(bidder.id, newRemainingPurse)

      outcomes.push({
        serialNumber: result.serialNumber,
        outcome: insufficientFunds ? 'applied_with_warning' : 'applied',
        message: insufficientFunds
          ? `Applied, but this leaves ${bidder.user?.name || bidder.username} at a negative purse (₹${newRemainingPurse.toLocaleString('en-IN')}) - review manually.`
          : undefined
      })
    }

    const appliedAnything = outcomes.some(o => o.outcome === 'applied' || o.outcome === 'applied_with_warning')
    if (appliedAnything) {
      await prisma.auction.update({
        where: { id: params.id },
        data: { bidHistory: bidHistory as any }
      })
      triggerAuctionEvent(params.id, 'players-updated', {
        players: changedPlayers,
        bidders: Array.from(bidderPurseAfter.entries()).map(([id, remainingPurse]) => ({ id, remainingPurse }))
      } as any).catch(() => {})
    }

    // Explicit currentSerialNumber, if given, is trusted directly rather
    // than merged against an "expected previous" value - unlike
    // reconcile-offline's built-in console, this tool never knew Squady's
    // own currentPlayerId to begin with, so there's nothing to reconcile
    // against; the admin syncing is telling us who's up, and that's applied
    // as-is.
    let currentPickHandled = false
    if (parsed.data.currentSerialNumber !== undefined) {
      currentPickHandled = true
      if (parsed.data.currentSerialNumber === null) {
        await prisma.auction.update({ where: { id: params.id }, data: { currentPlayerId: null } })
        triggerAuctionEvent(params.id, 'auction-pool-exhausted', {}).catch(() => {})
      } else {
        const pickedPlayer = await prisma.player.findFirst({
          where: { auctionId: params.id, serialNumber: parsed.data.currentSerialNumber },
          select: {
            id: true, status: true, auctionId: true, isIcon: true, data: true,
            lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true
          }
        })
        if (pickedPlayer && pickedPlayer.status === 'AVAILABLE') {
          await prisma.auction.update({ where: { id: params.id }, data: { currentPlayerId: pickedPlayer.id } })
          triggerAuctionEvent(params.id, 'new-player', { player: pickedPlayer } as any).catch(() => {})
        } else {
          // Not fatal - fall through to the auto-advance fallback below,
          // same as when currentSerialNumber is omitted entirely.
          currentPickHandled = false
        }
      }
    }

    // Same fallback as reconcile-offline/route.ts: if the player that was
    // live when the outage started got resolved (here, or by an earlier
    // sync) and nothing above already moved currentPlayerId on, this
    // catches it up rather than leaving the auction silently pointing at a
    // dead player forever.
    if (!currentPickHandled) {
      const freshAuction = await prisma.auction.findUnique({ where: { id: params.id }, select: { currentPlayerId: true } })
      const stuckPlayer = freshAuction?.currentPlayerId
        ? await prisma.player.findUnique({ where: { id: freshAuction.currentPlayerId }, select: { status: true } })
        : null

      if (!freshAuction?.currentPlayerId || !stuckPlayer || stuckPlayer.status !== 'AVAILABLE') {
        let availablePlayers = await prisma.player.findMany({
          where: { auctionId: params.id, status: 'AVAILABLE' },
          select: { id: true, isIcon: true }
        })

        if (availablePlayers.length === 0) {
          const unsoldPlayers = await prisma.player.findMany({
            where: { auctionId: params.id, status: 'UNSOLD' },
            select: { id: true }
          })
          if (unsoldPlayers.length > 0) {
            await prisma.player.updateMany({
              where: { id: { in: unsoldPlayers.map(p => p.id) }, auctionId: params.id, status: 'UNSOLD' },
              data: { status: 'AVAILABLE', soldTo: null, soldPrice: null }
            })
            availablePlayers = await prisma.player.findMany({
              where: { auctionId: params.id, status: 'AVAILABLE' },
              select: { id: true, isIcon: true }
            })
            triggerAuctionEvent(params.id, 'players-updated', {
              players: availablePlayers.map(p => ({ id: p.id, status: 'AVAILABLE', soldTo: null, soldPrice: null }))
            } as any).catch(() => {})
          }
        }

        const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
        const pool = iconPlayersAvailable.length > 0 ? iconPlayersAvailable : availablePlayers.filter(p => !p.isIcon)
        const nextPlayerId = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)].id : null

        await prisma.auction.update({ where: { id: params.id }, data: { currentPlayerId: nextPlayerId } })

        if (nextPlayerId) {
          const fullNextPlayer = await prisma.player.findUnique({
            where: { id: nextPlayerId },
            select: {
              id: true, status: true, isIcon: true, data: true, auctionId: true,
              lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true
            }
          })
          triggerAuctionEvent(params.id, 'new-player', { player: fullNextPlayer } as any).catch(() => {})
        } else {
          triggerAuctionEvent(params.id, 'auction-pool-exhausted', {}).catch(() => {})
        }
      }
    }

    const finalAuction = await prisma.auction.findUnique({ where: { id: params.id }, select: { currentPlayerId: true } })
    const currentPlayer = finalAuction?.currentPlayerId
      ? await prisma.player.findUnique({
          where: { id: finalAuction.currentPlayerId },
          select: {
            id: true, status: true, isIcon: true, data: true, serialNumber: true,
            lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true
          }
        })
      : null

    return NextResponse.json({ success: true, outcomes, currentPlayer }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('Error applying external sync:', error)
    logEventAsync({ category: 'api_error', eventName: 'external_sync', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: CORS_HEADERS })
  }
}
