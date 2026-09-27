import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { logEventAsync, describeError } from '@/lib/observability'

const editSoldPlayerSchema = z.object({
  playerId: z.string().trim().min(1),
  bidderId: z.string().trim().min(1),
  soldPrice: z.number().positive(),
})

// POST /api/auction/[id]/edit-sold-player
//
// Corrects an already-SOLD player's buyer and/or price - the "Edit Sold
// Data" action on the admin console. Before this route existed, there was
// no way to fix a wrong bidder or a misheard amount once the auction had
// moved on to the next player; undo-sale only reverts the MOST RECENT sale,
// and doesn't let the admin re-enter a corrected value in the same step.
//
// Reassigns the purse impact exactly like a real sale would: refunds the
// original buyer (if the buyer is changing) and deducts the new amount from
// the new buyer, re-checking both purse sufficiency and the destination
// team's size limit - the same "purse reinforcement" mark-sold itself
// enforces, so a correction can't silently create an impossible team.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsedBody = editSoldPlayerSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'playerId, bidderId, and a positive soldPrice are required' }, { status: 400 })
    }
    const { playerId, bidderId: newBidderId, soldPrice: newSoldPrice } = parsedBody.data

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true, rules: true, bidHistory: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Security: only this auction's own admin (or a super admin) may edit
    // its sold records.
    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can edit a sold player\'s record' }, { status: 403 })
    }

    const player = await prisma.player.findUnique({ where: { id: playerId } })
    if (!player || player.auctionId !== params.id) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }
    if (player.status !== 'SOLD' || !player.soldTo || player.soldPrice == null) {
      return NextResponse.json({ error: 'Only a SOLD player\'s record can be edited' }, { status: 400 })
    }

    const oldBidderId = player.soldTo
    const oldSoldPrice = player.soldPrice
    const bidderChanged = oldBidderId !== newBidderId

    const newBidder = await prisma.bidder.findUnique({ where: { id: newBidderId } })
    if (!newBidder || newBidder.auctionId !== params.id) {
      return NextResponse.json({ error: 'Selected bidder does not belong to this auction' }, { status: 400 })
    }

    let oldBidder: { id: string; remainingPurse: number } | null = null
    if (bidderChanged) {
      oldBidder = await prisma.bidder.findUnique({
        where: { id: oldBidderId },
        select: { id: true, remainingPurse: true }
      })
      if (!oldBidder) {
        return NextResponse.json({ error: 'Original bidder not found' }, { status: 404 })
      }
    }

    // Purse math: refund the old sale amount, deduct the new one - from the
    // same bidder if unchanged (this bidder already "spent" the old price
    // on this exact player, so that gets added back before the new amount
    // is taken out), or across two bidders if reassigning.
    const newBidderRemainingBeforeThisSale = bidderChanged
      ? newBidder.remainingPurse
      : newBidder.remainingPurse + oldSoldPrice
    const newBidderRemainingAfter = newBidderRemainingBeforeThisSale - newSoldPrice

    if (newBidderRemainingAfter < 0) {
      return NextResponse.json({
        error: `Insufficient purse: ${newBidder.teamName || newBidder.username} has ₹${newBidderRemainingBeforeThisSale.toLocaleString('en-IN')} available for this player, but the new value is ₹${newSoldPrice.toLocaleString('en-IN')}.`
      }, { status: 400 })
    }

    // Team-size limit only matters when moving the player to a DIFFERENT
    // team - the current bidder already "has" this player, so reassigning
    // them the same player at a different price doesn't change their count.
    if (bidderChanged) {
      const rules = auction.rules as { maxTeamSize?: number; mandatoryTeamSize?: number } | null
      const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
      if (maxTeamSize) {
        const newBidderPlayerCount = await prisma.player.count({
          where: { auctionId: params.id, soldTo: newBidderId, status: 'SOLD' }
        })
        // Team size includes the bidder themself, so they can hold at most
        // maxTeamSize - 1 players.
        if (newBidderPlayerCount >= maxTeamSize - 1) {
          return NextResponse.json({
            error: `${newBidder.teamName || newBidder.username}'s squad is already at the maximum of ${maxTeamSize} (including the bidder). Cannot reassign another player to them.`
          }, { status: 400 })
        }
      }
    }

    // Keep the bid history's own 'sold' record for this player in sync -
    // it's what the public sold ticker and bid-history panels read from,
    // and would otherwise keep showing the old bidder/amount forever.
    const newBidderName = newBidder.teamName || newBidder.username
    const rawHistory = Array.isArray(auction.bidHistory) ? auction.bidHistory as Record<string, unknown>[] : []
    const updatedHistory = rawHistory.map(entry => {
      if (entry?.type === 'sold' && entry?.playerId === playerId) {
        return { ...entry, bidderId: newBidderId, bidderName: newBidderName, teamName: newBidder.teamName, amount: newSoldPrice }
      }
      return entry
    })

    await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: playerId },
        data: { soldTo: newBidderId, soldPrice: newSoldPrice }
      })
      if (bidderChanged && oldBidder) {
        await tx.bidder.update({
          where: { id: oldBidder.id },
          data: { remainingPurse: oldBidder.remainingPurse + oldSoldPrice }
        })
      }
      await tx.bidder.update({
        where: { id: newBidderId },
        data: { remainingPurse: newBidderRemainingAfter }
      })
      await tx.auction.update({
        where: { id: params.id },
        data: { bidHistory: updatedHistory as any }
      })
    })

    const [updatedPlayer, updatedNewBidder, updatedOldBidder] = await Promise.all([
      prisma.player.findUnique({ where: { id: playerId } }),
      prisma.bidder.findUnique({ where: { id: newBidderId } }),
      bidderChanged && oldBidder
        ? prisma.bidder.findUnique({ where: { id: oldBidder.id } })
        : Promise.resolve(null)
    ])

    const updatedBidders = [
      updatedNewBidder ? { id: updatedNewBidder.id, remainingPurse: updatedNewBidder.remainingPurse } : null,
      updatedOldBidder ? { id: updatedOldBidder.id, remainingPurse: updatedOldBidder.remainingPurse } : null,
    ].filter((b): b is { id: string; remainingPurse: number } => b != null)

    // Broadcast so every other connected screen (public, presenter, other
    // admin tabs) picks up the correction - the edit already succeeded in
    // the DB above, so a Pusher hiccup here must never turn that success
    // into a misleading 500.
    triggerAuctionEvent(params.id, 'players-updated', {
      players: [{ id: playerId, status: 'SOLD', soldTo: newBidderId, soldPrice: newSoldPrice }],
      bidders: updatedBidders
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({
      success: true,
      player: updatedPlayer,
      updatedBidders
    })
  } catch (error) {
    console.error('Error editing sold player:', error)
    logEventAsync({ category: 'api_error', eventName: 'edit_sold_player', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
