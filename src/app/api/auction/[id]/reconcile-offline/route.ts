import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { invalidatePlayers, invalidateBidders } from '@/lib/cache'

// Applies final sold/unsold results recorded by the offline fallback page
// (src/app/auction/[id]/offline) once the live app is reachable again. This
// is deliberately NOT the same code path as mark-sold/mark-unsold: those
// derive the winning bid from the server's own bid history, which doesn't
// exist for a sale that happened entirely offline - the bidder and amount
// have to be accepted directly instead.
//
// Each result is applied at most once (matched by its client-generated id
// against the sold/unsold event already recorded, when present) and a
// result that would overwrite a DIFFERENT existing outcome for the same
// player is never silently applied - it comes back as a conflict for the
// admin to resolve by hand, since two different "final" answers for one
// player means something needs a human decision, not an automatic pick.
const resultSchema = z.object({
  id: z.string().trim().min(1),
  playerId: z.string().trim().min(1),
  status: z.enum(['SOLD', 'UNSOLD']),
  bidderId: z.string().trim().min(1).optional(),
  amount: z.coerce.number().positive().optional(),
})

// Sent only when the offline console has nothing else to sync but is
// still showing a player it drew on its own while genuinely offline (no
// sold/unsold ever recorded for them) - see the auto-pick effect in
// offline/page.tsx. expectedPreviousPlayerId is whatever the offline
// console believed the live currentPlayerId was right before it started
// guessing; if the live value has since moved on to something else (a
// human resolved it some other way while this console was dark), this is
// rejected as a conflict rather than blindly overwritten.
const currentPickSchema = z.object({
  playerId: z.string().trim().min(1).nullable(),
  expectedPreviousPlayerId: z.string().trim().min(1).nullable(),
})

const requestSchema = z.object({
  results: z.array(resultSchema).max(200),
  currentPick: currentPickSchema.optional(),
}).refine(data => data.results.length > 0 || data.currentPick !== undefined, {
  message: 'Provide at least one result or a current-player update'
})

type Outcome = 'applied' | 'applied_with_warning' | 'skipped' | 'conflict' | 'error'

interface ResultOutcome {
  id: string
  playerId: string
  outcome: Outcome
  message?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid reconciliation payload' }, { status: 400 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true, bidHistory: true, currentPlayerId: true }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)

    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can reconcile offline results' }, { status: 403 })
    }

    let bidHistory: Record<string, unknown>[] = Array.isArray(auction.bidHistory)
      ? (auction.bidHistory as Record<string, unknown>[])
      : []
    const outcomes: ResultOutcome[] = []
    const touchedBidderIds = new Set<string>()
    // What actually changed this call, for the live 'players-updated'
    // broadcast below - mirrors the shape mark-sold/route.ts sends, so an
    // admin console connected live merges these in instead of needing a
    // reload to see purses/statuses this batch touched.
    const changedPlayers: Array<{ id: string; status: string; soldTo: string | null; soldPrice: number | null }> = []
    const bidderPurseAfter = new Map<string, number>()

    // Sequential on purpose: each SOLD result reads-then-writes a bidder's
    // remainingPurse, so two results for the same bidder must not overlap.
    for (const result of parsed.data.results) {
      const player = await prisma.player.findUnique({
        where: { id: result.playerId },
        select: { id: true, auctionId: true, status: true, soldTo: true, soldPrice: true, data: true }
      })

      if (!player || player.auctionId !== params.id) {
        outcomes.push({ id: result.id, playerId: result.playerId, outcome: 'error', message: 'Player not found in this auction' })
        continue
      }

      const playerData = player.data as Record<string, unknown> | null
      const playerName = (playerData?.name as string) || (playerData?.Name as string) || 'Player'
      const alreadyMatches =
        (result.status === 'SOLD' && player.status === 'SOLD' && player.soldTo === result.bidderId && player.soldPrice === result.amount) ||
        (result.status === 'UNSOLD' && player.status === 'UNSOLD')

      if (alreadyMatches) {
        outcomes.push({ id: result.id, playerId: result.playerId, outcome: 'skipped', message: 'Already recorded' })
        continue
      }

      const hasConflictingOutcome = player.status === 'SOLD' || player.status === 'UNSOLD'
      if (hasConflictingOutcome) {
        outcomes.push({
          id: result.id,
          playerId: result.playerId,
          outcome: 'conflict',
          message: `${playerName} is already recorded as ${player.status} in the live auction - resolve manually before re-applying.`
        })
        continue
      }

      if (result.status === 'UNSOLD') {
        await prisma.player.update({
          where: { id: result.playerId },
          data: { status: 'UNSOLD', soldTo: null, soldPrice: null }
        })
        bidHistory = [{ type: 'unsold', playerId: result.playerId, playerName, timestamp: result.id }, ...bidHistory]
        changedPlayers.push({ id: result.playerId, status: 'UNSOLD', soldTo: null, soldPrice: null })
        outcomes.push({ id: result.id, playerId: result.playerId, outcome: 'applied' })
        continue
      }

      // SOLD
      if (!result.bidderId || result.amount == null) {
        outcomes.push({ id: result.id, playerId: result.playerId, outcome: 'error', message: 'Missing bidder or amount for a sold result' })
        continue
      }

      const bidder = await prisma.bidder.findUnique({
        where: { id: result.bidderId },
        include: { user: { select: { name: true } } }
      })

      if (!bidder || bidder.auctionId !== params.id) {
        outcomes.push({ id: result.id, playerId: result.playerId, outcome: 'error', message: 'Bidder not found in this auction' })
        continue
      }

      const newRemainingPurse = bidder.remainingPurse - result.amount
      const insufficientFunds = newRemainingPurse < 0

      await prisma.$transaction([
        prisma.player.update({
          where: { id: result.playerId },
          data: { status: 'SOLD', soldTo: bidder.id, soldPrice: result.amount, soldAt: new Date() }
        }),
        prisma.bidder.update({
          where: { id: bidder.id },
          data: { remainingPurse: newRemainingPurse }
        })
      ])

      touchedBidderIds.add(bidder.id)
      bidHistory = [{
        type: 'sold',
        playerId: result.playerId,
        playerName,
        bidderId: bidder.id,
        bidderName: bidder.user?.name || bidder.username,
        teamName: bidder.teamName,
        amount: result.amount,
        timestamp: result.id
      }, ...bidHistory]
      changedPlayers.push({ id: result.playerId, status: 'SOLD', soldTo: bidder.id, soldPrice: result.amount })
      // Last write wins if this bidder appears in more than one result in
      // the same batch - bidderPurseAfter always ends up holding their
      // truly final purse, since results are applied sequentially above.
      bidderPurseAfter.set(bidder.id, newRemainingPurse)

      outcomes.push({
        id: result.id,
        playerId: result.playerId,
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

      // One refresh broadcast for anyone still connected, rather than one
      // per reconciled result - this is a bulk catch-up, not a live event.
      // Carries the same shape mark-sold/route.ts sends (changed players +
      // bidder purses) rather than an empty payload, so a still-open admin
      // console actually merges these in instead of silently no-op'ing.
      triggerAuctionEvent(params.id, 'players-updated', {
        players: changedPlayers,
        bidders: Array.from(bidderPurseAfter.entries()).map(([id, remainingPurse]) => ({ id, remainingPurse }))
      } as any).catch(() => {})
    }

    // Explicit request: the offline console is telling us exactly who it's
    // been showing, rather than leaving it to the fallback below to
    // independently re-roll (which could land on a different player than
    // whichever one the room has actually been looking at this whole
    // time). Handled first, and precludes the fallback entirely - a
    // request never carries both non-empty results and a currentPick (see
    // offline/page.tsx), so there's nothing for that logic to reconcile
    // against here anyway.
    let currentPickOutcome: 'applied' | 'skipped' | 'conflict' | undefined
    if (parsed.data.currentPick) {
      const { playerId: pickedPlayerId, expectedPreviousPlayerId } = parsed.data.currentPick
      const liveCurrentPlayerId = auction.currentPlayerId ?? null

      if (liveCurrentPlayerId !== (expectedPreviousPlayerId ?? null)) {
        currentPickOutcome = 'conflict'
      } else if (liveCurrentPlayerId === pickedPlayerId) {
        currentPickOutcome = 'skipped'
      } else if (pickedPlayerId === null) {
        await prisma.auction.update({ where: { id: params.id }, data: { currentPlayerId: null } })
        triggerAuctionEvent(params.id, 'auction-pool-exhausted', {}).catch(() => {})
        currentPickOutcome = 'applied'
      } else {
        const pickedPlayer = await prisma.player.findUnique({
          where: { id: pickedPlayerId },
          select: {
            id: true, status: true, auctionId: true, isIcon: true, data: true,
            lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true
          }
        })
        if (!pickedPlayer || pickedPlayer.auctionId !== params.id || pickedPlayer.status !== 'AVAILABLE') {
          currentPickOutcome = 'conflict'
        } else {
          await prisma.auction.update({ where: { id: params.id }, data: { currentPlayerId: pickedPlayerId } })
          triggerAuctionEvent(params.id, 'new-player', { player: pickedPlayer } as any).catch(() => {})
          currentPickOutcome = 'applied'
        }
      }
    }

    // The live auction's currentPlayerId is untouched by everything above -
    // this endpoint applies FINAL results, it never runs the "pick the next
    // player" step mark-sold/route.ts does after every sale. If the player
    // that was live when the outage started got resolved (here, or by an
    // earlier sync) that leaves the auction silently pointing at a dead
    // player forever: nothing broadcasts, nothing advances, and the admin
    // console that comes back online just sits frozen on it. Catch that up
    // now, mirroring mark-sold's own selection exactly (icon players first,
    // recycle UNSOLD back to AVAILABLE once none remain, then regular
    // players) - but only when the current pick is actually dead, and only
    // as a fallback when the client hasn't already told us exactly who it's
    // showing (above); a still-AVAILABLE current player (the outage ended
    // before it got resolved) is correctly left alone either way.
    if (!parsed.data.currentPick && auction.currentPlayerId) {
      const stuckPlayer = await prisma.player.findUnique({
        where: { id: auction.currentPlayerId },
        select: { status: true }
      })

      if (!stuckPlayer || stuckPlayer.status !== 'AVAILABLE') {
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

        await prisma.auction.update({
          where: { id: params.id },
          data: { currentPlayerId: nextPlayerId }
        })

        if (nextPlayerId) {
          const fullNextPlayer = await prisma.player.findUnique({
            where: { id: nextPlayerId },
            select: {
              id: true,
              status: true,
              isIcon: true,
              data: true,
              auctionId: true,
              lastYearPrice: true,
              lastYearTeamName: true,
              lastYearBidderName: true,
              lastYearAuctionName: true
            }
          })
          triggerAuctionEvent(params.id, 'new-player', { player: fullNextPlayer } as any).catch(() => {})
        } else {
          triggerAuctionEvent(params.id, 'auction-pool-exhausted', {}).catch(() => {})
        }
      }
    }

    // Whatever the final currentPlayerId ended up being after everything
    // above (an accepted/conflicted currentPick, the fallback auto-advance,
    // or simply untouched) - always tell the client. The offline console
    // runs no live subscription of its own (by design, it makes zero
    // network calls except this one), so without this its view of "who's
    // current" only ever updates on a page reload, and only then if some
    // OTHER tab happened to have already re-mirrored the fresher value.
    // A batch of offline results just committed (players sold/unsold, purses
    // deducted). Clear the cached roster and purses so the next poll is fresh.
    await Promise.all([invalidatePlayers(params.id), invalidateBidders(params.id)])

    const freshAuction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { currentPlayerId: true }
    })
    const currentPlayer = freshAuction?.currentPlayerId
      ? await prisma.player.findUnique({
          where: { id: freshAuction.currentPlayerId },
          select: {
            id: true, status: true, isIcon: true, data: true,
            lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true
          }
        })
      : null

    return NextResponse.json({
      success: true,
      outcomes,
      currentPlayer,
      ...(currentPickOutcome ? { currentPickOutcome } : {})
    })
  } catch (error) {
    console.error('Error reconciling offline results:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
