import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { logEventAsync, describeError } from '@/lib/observability'

const markUnsoldSchema = z.object({
  playerId: z.string().trim().min(1),
})

// Thrown inside the transaction below when a concurrent request (a retried
// call after a dropped response, or two admin tabs) already resolved this
// exact player between our initial read and this write.
class AlreadyResolvedError extends Error {}

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
    const parsedBody = markUnsoldSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
    }

    const { playerId } = parsedBody.data

    // Fetch auction - only bidHistory is actually read below; the player
    // list was never used from this query (recycling re-fetches its own
    // narrowly-scoped player rows further down).
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, bidHistory: true, createdById: true }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Security: only this auction's own admin (or a super admin) may resolve
    // a player for it. Previously this route only checked that *someone*
    // was logged in - any bidder account, or an admin of a completely
    // different auction, could call this endpoint directly with any player id.
    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can mark a player unsold' }, { status: 403 })
    }

    // Fetch current player
    const currentPlayer = await prisma.player.findUnique({
      where: { id: playerId }
    })

    if (!currentPlayer || currentPlayer.auctionId !== params.id) {
      return NextResponse.json({ error: 'Invalid player' }, { status: 400 })
    }

    // Idempotency guard - mark-sold already has an equivalent check
    // ("already sold, duplicate prevented"); this route never had one. A
    // retried or raced call would otherwise re-run the whole "pick a next
    // player" step below a second time and silently overwrite the first
    // call's already-correct currentPlayerId with a fresh random pick,
    // skipping a player's turn without ever actually presenting it.
    if (currentPlayer.status !== 'AVAILABLE') {
      return NextResponse.json({
        error: 'This player has already been resolved (sold or unsold). Duplicate call prevented.'
      }, { status: 400 })
    }

    const playerName = currentPlayer?.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'

    // Broadcast unsold event IMMEDIATELY for instant real-time updates (before DB writes)
    triggerAuctionEvent(params.id, 'player-unsold', {
      playerId: playerId,
      playerName: playerName
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    // OPTIMIZED: Fetch only AVAILABLE players (not all players). Excludes
    // this player explicitly - its own status update hasn't been written
    // yet (that now happens later, inside the atomic transaction below).
    let availablePlayers = await prisma.player.findMany({
      where: {
        auctionId: params.id,
        status: 'AVAILABLE',
        id: { not: playerId }
      },
      select: {
        id: true,
        status: true,
        isIcon: true
      }
    })
    
    // Collects players whose status changed this request (recycled UNSOLD ->
    // AVAILABLE below, plus this player's own UNSOLD update further down) so
    // they go out in the single 'players-updated' broadcast at the end of
    // this handler instead of a separate trigger per change. Deliberately
    // excludes the `data` JSON blob - see the same note in mark-sold's route.
    let recycledPlayersForBroadcast: Array<{ id: string; status: string; isIcon: boolean; soldTo: string | null; soldPrice: number | null }> = []

    // If no available players, automatically recycle UNSOLD players back to AVAILABLE
    // IMPORTANT: Only recycle UNSOLD players, NEVER recycle SOLD players
    if (availablePlayers.length === 0) {
      // OPTIMIZED: Fetch only UNSOLD players (not all players)
      const unsoldPlayers = await prisma.player.findMany({
        where: {
          auctionId: params.id,
          status: 'UNSOLD' // Explicit status check ensures SOLD players are never fetched
        },
        select: {
          id: true,
          status: true,
          isIcon: true
        }
      })
      
      // Safety check: ensure no SOLD players (shouldn't happen with status filter)
      if (unsoldPlayers.some(p => p.status !== 'UNSOLD')) {
        console.error('CRITICAL: Attempted to recycle SOLD players - this should never happen!')
        logEventAsync({ category: 'api_error', eventName: 'mark_unsold', auctionId: params.id, success: false, message: 'CRITICAL: recycle-guard tripped - a SOLD player appeared in the UNSOLD recycling pool', metadata: { guard: 'recycle_sold_players' } })
        return NextResponse.json({ error: 'Internal error: Cannot recycle sold players' }, { status: 500 })
      }
      
      if (unsoldPlayers.length > 0) {
        // Convert only UNSOLD players back to AVAILABLE (never SOLD players)
        await prisma.player.updateMany({
          where: {
            id: { in: unsoldPlayers.map(p => p.id) },
            auctionId: params.id,
            status: 'UNSOLD' // Explicit status check ensures SOLD players are never updated
          },
          data: {
            status: 'AVAILABLE',
            soldTo: null,
            soldPrice: null
          }
        })
        
        // OPTIMIZED: Fetch only AVAILABLE players after conversion
        const recycledPlayers = await prisma.player.findMany({
          where: {
            auctionId: params.id,
            status: 'AVAILABLE',
            id: { not: playerId }
          },
          select: {
            id: true,
            status: true,
            isIcon: true,
            soldTo: true,
            soldPrice: true
          }
        })

        availablePlayers = recycledPlayers
        recycledPlayersForBroadcast = recycledPlayers

        // Recycled players go out in the single combined 'players-updated'
        // broadcast below instead of their own trigger.
      }
    }
    
    let nextPlayer = null
    
    if (availablePlayers.length > 0) {
      // ICON PLAYERS MUST BE AUCTIONED FIRST
      // Only show regular players after ALL icon players have been auctioned (SOLD or UNSOLD)
      const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
      
      let selectedPlayerId: string | null = null
      
      if (iconPlayersAvailable.length > 0) {
        // There are still icon players available - MUST select from icon players only
        // Regular players cannot be shown until all icon players are processed
        selectedPlayerId = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)].id
      } else {
        // All icon players have been processed (either SOLD or UNSOLD and not yet recycled)
        // Now we can show regular players
        const regularPlayersAvailable = availablePlayers.filter(p => !p.isIcon)
        if (regularPlayersAvailable.length > 0) {
          selectedPlayerId = regularPlayersAvailable[Math.floor(Math.random() * regularPlayersAvailable.length)].id
        }
      }
      
      // CRITICAL: Fetch full player data including the `data` field
      if (selectedPlayerId) {
        nextPlayer = await prisma.player.findUnique({
          where: { id: selectedPlayerId },
          select: {
            id: true,
            status: true,
            isIcon: true,
            data: true, // Include full player data
            auctionId: true,
            lastYearPrice: true,
            lastYearTeamName: true,
            lastYearBidderName: true,
            lastYearAuctionName: true
          }
        })
      }
    }

    // Fetch current bid history
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }
    
    // Remove ALL bids for this player (clean slate when marked unsold)
    // Keep bids for other players and other event types
    const cleanedHistory = bidHistory.filter(entry => {
      // Keep entries that don't belong to this player
      if (entry.playerId !== playerId) return true
      // Remove all bids and bid-undo entries for this player
      if (!entry.type || entry.type === 'bid' || entry.type === 'bid-undo') return false
      // Keep sold/unsold events for history (but there shouldn't be sold events for unsold players)
      return true
    })
    
    // Add unsold event to bid history
    const unsoldEvent = {
      type: 'unsold',
      playerId: playerId,
      playerName: playerName,
      timestamp: new Date().toISOString()
    }
    
    const updatedHistory = [unsoldEvent, ...cleanedHistory]

    // Commit the UNSOLD status and the advance to the next player as one
    // atomic unit - previously these were two separate, sequential writes
    // (player.update, then a later auction.update), so a failure between
    // them left the player correctly UNSOLD but the auction still pointing
    // at that now-resolved player forever. The race-guarded updateMany also
    // closes the gap the idempotency check above can't catch on its own:
    // two requests racing so closely that both pass that check before
    // either writes would otherwise both run "pick a next player" and the
    // second call's pick would silently clobber the first's.
    try {
      await prisma.$transaction(async (tx) => {
        const unsoldResult = await tx.player.updateMany({
          where: { id: playerId, status: 'AVAILABLE' },
          data: { status: 'UNSOLD', soldTo: null, soldPrice: null }
        })
        if (unsoldResult.count === 0) {
          throw new AlreadyResolvedError()
        }
        await tx.auction.update({
          where: { id: params.id },
          data: {
            currentPlayerId: nextPlayer?.id || null,
            bidHistory: updatedHistory as any
          }
        })
      })
    } catch (error) {
      if (error instanceof AlreadyResolvedError) {
        return NextResponse.json({
          error: 'This player has already been resolved (sold or unsold). Duplicate call prevented.'
        }, { status: 400 })
      }
      throw error
    }

    // Broadcast new player if exists - the DB already moved on above, so a
    // Pusher hiccup here must never turn that success into a 500.
    if (nextPlayer) {
      await triggerAuctionEvent(params.id, 'new-player', {
        player: nextPlayer
      } as any).catch(err => console.error('Pusher error (non-critical):', err))
    }

    // Broadcast players updated event. Combines this player's own UNSOLD
    // update with any other UNSOLD players recycled back to AVAILABLE above
    // into a single trigger, instead of one per change. Deliberately omits
    // each player's `data` JSON blob - see the same note in mark-sold's route.
    await triggerAuctionEvent(params.id, 'players-updated', {
      players: [
        ...recycledPlayersForBroadcast,
        ...(currentPlayer ? [{
          id: currentPlayer.id,
          status: 'UNSOLD',
          soldTo: null,
          soldPrice: null
        }] : [])
      ]
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ 
      success: true,
      nextPlayer
    })
  } catch (error) {
    console.error('Error marking player as unsold:', error)
    logEventAsync({ category: 'api_error', eventName: 'mark_unsold', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

