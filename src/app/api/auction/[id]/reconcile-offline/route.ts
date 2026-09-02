import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'

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

const requestSchema = z.object({
  results: z.array(resultSchema).min(1).max(200),
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
      select: { id: true, createdById: true, bidHistory: true }
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
          data: { status: 'SOLD', soldTo: bidder.id, soldPrice: result.amount }
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
      triggerAuctionEvent(params.id, 'players-updated', {}).catch(() => {})
    }

    return NextResponse.json({ success: true, outcomes })
  } catch (error) {
    console.error('Error reconciling offline results:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
