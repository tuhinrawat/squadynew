import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { triggerAuctionEvent } from '@/lib/pusher'
import { logEventAsync, describeError } from '@/lib/observability'

const markSoldSchema = z.object({
  playerId: z.string().trim().min(1),
})

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
    const parsedBody = markSoldSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
    }

    const { playerId } = parsedBody.data

    // OPTIMIZED: Fetch only required fields in parallel
    const [auction, currentPlayer] = await Promise.all([
      prisma.auction.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          currentPlayerId: true,
          rules: true,
          bidHistory: true,
          bidders: {
            select: {
              id: true,
              username: true,
              teamName: true,
              remainingPurse: true,
              user: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      }),
      prisma.player.findUnique({
        where: { id: playerId },
        select: {
          id: true,
          auctionId: true,
          status: true,
          soldTo: true,
          data: true
        }
      })
    ])

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    if (!currentPlayer || currentPlayer.auctionId !== params.id) {
      return NextResponse.json({ error: 'Invalid player' }, { status: 400 })
    }

    // CRITICAL: Re-fetch bid history right before updating to ensure we have the latest
    // This prevents race conditions where bids were added after the initial fetch
    const freshAuction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: {
        bidHistory: true
      }
    })

    // Parse bid history to get current highest bid (filter for current player only)
    let bidHistory: any[] = []
    if (freshAuction?.bidHistory && typeof freshAuction.bidHistory === 'object') {
      const bidHistoryData = freshAuction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    // CRITICAL: Filter bid history to only include bids for the current player (strict)
    // This prevents using bids from other players or legacy untagged bids
    const currentPlayerBidHistory = bidHistory
      .filter(bid => bid.playerId === currentPlayer.id)
      .filter(bid => bid.type !== 'sold' && bid.type !== 'unsold')

    if (currentPlayerBidHistory.length === 0) {
      return NextResponse.json({ error: 'No bids on this player' }, { status: 400 })
    }

    // Get the highest bid for this specific player
    const highestBid = currentPlayerBidHistory[0]
    const winningBidderId = auction.bidders.find(b => b.id === highestBid.bidderId)?.id

    if (!winningBidderId) {
      return NextResponse.json({ error: 'Winning bidder not found' }, { status: 404 })
    }

    // CRITICAL: Check if player is already SOLD to prevent duplicate sales
    // Do this check AFTER we know the winning bidder ID so we can check if it's the same bidder
    if (currentPlayer.status === 'SOLD') {
      // If already sold to the same bidder, this is a duplicate sale attempt
      if (currentPlayer.soldTo === winningBidderId) {
        return NextResponse.json({ 
          error: `This player is already sold to this bidder. Duplicate sale prevented. The bidder's purse was not deducted.` 
        }, { status: 400 })
      }
      return NextResponse.json({ 
        error: `This player is already sold to another bidder. Cannot sell again.` 
      }, { status: 400 })
    }

    // Fetch winning bidder with user relation (fresh from database to ensure correct purse)
    const winningBidder = await prisma.bidder.findUnique({
      where: { id: winningBidderId },
      include: { user: true }
    })

    if (!winningBidder) {
      return NextResponse.json({ error: 'Winning bidder not found' }, { status: 404 })
    }

    // Security: Ensure winning bidder belongs to this auction
    if (winningBidder.auctionId !== params.id) {
      return NextResponse.json({ 
        error: 'Winning bidder does not belong to this auction' 
      }, { status: 403 })
    }

    // Check if bidder has sufficient remaining purse for the bid amount
    if (winningBidder.remainingPurse < highestBid.amount) {
      const bidderName = winningBidder.user?.name || winningBidder.username
      const teamName = winningBidder.teamName || 'No Team'
      return NextResponse.json({
        error: `${bidderName} (${teamName}): Insufficient funds. Bidder has ₹${winningBidder.remainingPurse.toLocaleString('en-IN')} remaining, but bid amount is ₹${highestBid.amount.toLocaleString('en-IN')}.`
      }, { status: 400 })
    }

    // Enforce purse and squad-size feasibility at sale time as a safety net
    const rules = auction.rules as any
    const mandatoryTeamSize = Number(rules?.mandatoryTeamSize) || null
    // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
    const maxTeamSize = rules?.maxTeamSize ? Number(rules.maxTeamSize) : (rules?.mandatoryTeamSize ? Number(rules.mandatoryTeamSize) : null)
    const minPerPlayerReserve = Number(rules?.minPerPlayerReserve) || Number(rules?.minBidIncrement) || 0

    // OPTIMIZED: Count already-bought players with status filter for faster query
    const playersBoughtByBidder = await prisma.player.count({
      where: { 
        auctionId: params.id, 
        soldTo: winningBidder.id,
        status: 'SOLD' // Add status filter for faster indexed query
      }
    })

    // CRITICAL: Team size includes the bidder, so if they've bought (maxTeamSize - 1) players,
    // their team is full. Use >= instead of > to catch the exact limit.
    if (maxTeamSize && playersBoughtByBidder >= maxTeamSize - 1) {
      const bidderName = winningBidder.user?.name || winningBidder.username
      const teamName = winningBidder.teamName || 'No Team'
      return NextResponse.json({
        error: `${bidderName} (${teamName}): Team size limit reached (max ${maxTeamSize} players including you). Cannot acquire more players.`
      }, { status: 400 })
    }

    if (mandatoryTeamSize) {
      // Calculate remaining slots after this purchase
      // mandatoryTeamSize includes the bidder, so players to buy = mandatoryTeamSize - 1
      // After buying current player: remainingSlots = (mandatoryTeamSize - 1) - (playersBoughtByBidder + 1)
      // The +1 accounts for the current player being purchased
      const remainingSlotsAfterThis = Math.max((mandatoryTeamSize - 1) - (playersBoughtByBidder + 1), 0)
      const requiredReserve = remainingSlotsAfterThis * minPerPlayerReserve
      const remainingAfterBid = winningBidder.remainingPurse - highestBid.amount
      if (remainingAfterBid < requiredReserve) {
        const bidderName = winningBidder.user?.name || winningBidder.username
        const teamName = winningBidder.teamName || 'No Team'
        return NextResponse.json({
          error: `${bidderName} (${teamName}): Sale would leave insufficient purse to complete mandatory squad of ${mandatoryTeamSize}. Required reserve: ₹${requiredReserve.toLocaleString('en-IN')}, remaining after sale: ₹${Math.max(remainingAfterBid, 0).toLocaleString('en-IN')}.`
        }, { status: 400 })
      }
    }

    // Calculate new remaining purse
    const newRemainingPurse = winningBidder.remainingPurse - highestBid.amount

    // Broadcast player sold event IMMEDIATELY for instant real-time updates (before DB writes)
    const playerName = currentPlayer.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'
    triggerAuctionEvent(params.id, 'player-sold', {
      playerId: currentPlayer.id,
      bidderId: winningBidder.id,
      amount: highestBid.amount,
      playerName: playerName,
      bidderName: winningBidder.user?.name || winningBidder.username,
      teamName: winningBidder.teamName,
      bidderRemainingPurse: newRemainingPurse,
      updatedBidders: [{ id: winningBidder.id, remainingPurse: newRemainingPurse }]
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    // Update player and bidder atomically - if one fails, neither should
    // commit, otherwise a player can end up SOLD with the buyer's purse
    // never debited (or vice versa).
    await prisma.$transaction([
      prisma.player.update({
        where: { id: playerId },
        data: {
          status: 'SOLD',
          soldTo: winningBidder.id,
          soldPrice: highestBid.amount
        }
      }),
      // Deduct from bidder's remaining purse
      prisma.bidder.update({
        where: { id: winningBidder.id },
        data: {
          remainingPurse: newRemainingPurse
        }
      })
    ])

    // OPTIMIZED: Fetch only AVAILABLE players needed for next player selection (not all auction data)
    // This is much faster than fetching all players and bidders
    let availablePlayers = await prisma.player.findMany({
      where: {
        auctionId: params.id,
        status: 'AVAILABLE',
        id: { not: currentPlayer.id } // Exclude current player
      },
      select: {
        id: true,
        status: true,
        isIcon: true
      }
    })
    
    // Collects players whose status changed this request (recycled UNSOLD ->
    // AVAILABLE below, plus the just-sold player further down) so they go out
    // in the single 'players-updated' broadcast at the end of this handler
    // instead of a separate trigger per change. Deliberately excludes the
    // `data` JSON blob (full spreadsheet row) - clients already have it from
    // their initial load and only need the fields that actually changed, to
    // keep this broadcast well under Pusher's per-message size limit even
    // when hundreds of players get recycled at once.
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
        logEventAsync({ category: 'api_error', eventName: 'mark_sold', auctionId: params.id, success: false, message: 'CRITICAL: recycle-guard tripped - a SOLD player appeared in the UNSOLD recycling pool', metadata: { guard: 'recycle_sold_players' } })
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
        
        // OPTIMIZED: Fetch only AVAILABLE players after conversion (not all auction data)
        const recycledPlayers = await prisma.player.findMany({
          where: {
            auctionId: params.id,
            status: 'AVAILABLE',
            id: { not: currentPlayer.id } // Exclude current player
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
        // broadcast below (with the sold player) instead of their own trigger.
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

    // Add sold event to bid history
    const soldEvent = {
      type: 'sold',
      playerId: currentPlayer.id,
      playerName: playerName,
      bidderId: winningBidder.id,
      bidderName: winningBidder.user?.name || winningBidder.username,
      teamName: winningBidder.teamName,
      amount: highestBid.amount,
      timestamp: new Date().toISOString()
    }
    
    // CRITICAL: Preserve ALL bids in history - add sold event at the beginning
    // Do NOT filter or remove any bids - keep the complete bid history
    const updatedHistory = [soldEvent, ...bidHistory]
    
    // Log bid history for debugging
    console.log('📊 Mark Sold - Bid History Update:', {
      totalBids: bidHistory.length,
      currentPlayerBids: currentPlayerBidHistory.length,
      updatedHistoryLength: updatedHistory.length,
      currentPlayerId: currentPlayer.id
    })

    // Update auction
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        currentPlayerId: nextPlayer?.id || null,
        bidHistory: updatedHistory as any
      }
    })

    // Broadcast new player if exists - the sale already succeeded in the DB
    // above, so a Pusher hiccup here (a rejected trigger, an exceeded daily
    // message quota) must never turn that success into a misleading 500 -
    // the admin would see "Internal server error" for a sale that actually
    // went through, with the UI now out of sync with the database.
    if (nextPlayer) {
      await triggerAuctionEvent(params.id, 'new-player', {
        player: nextPlayer
      } as any).catch(err => console.error('Pusher error (non-critical):', err))
    } else {
      // Nothing AVAILABLE and nothing UNSOLD left to recycle - the pool is
      // genuinely exhausted. Without this, every connected screen (admin
      // included) waits forever for a 'new-player' event that will never
      // come, staying frozen on the player that was just sold.
      await triggerAuctionEvent(params.id, 'auction-pool-exhausted', {}).catch(err => console.error('Pusher error (non-critical):', err))
    }

    // Broadcast players updated event with the fields that changed, so
    // clients can merge locally instead of re-fetching (fire and forget).
    // Combines the just-sold player with any UNSOLD players recycled back to
    // AVAILABLE above into a single trigger, instead of one per change.
    // Deliberately omits each player's `data` JSON blob - clients already
    // have it and only need to know what changed, keeping this payload well
    // under Pusher's per-message size limit even when many players recycle
    // at once.
    triggerAuctionEvent(params.id, 'players-updated', {
      players: [
        ...recycledPlayersForBroadcast,
        {
          id: currentPlayer.id,
          status: 'SOLD',
          soldTo: winningBidder.id,
          soldPrice: highestBid.amount
        }
      ],
      bidders: [{ id: winningBidder.id, remainingPurse: newRemainingPurse }]
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ 
      success: true,
      nextPlayer,
      updatedBidder: {
        ...winningBidder,
        remainingPurse: winningBidder.remainingPurse - highestBid.amount
      }
    })
  } catch (error) {
    console.error('Error marking player as sold:', error)
    logEventAsync({ category: 'api_error', eventName: 'mark_sold', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

