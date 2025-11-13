import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { triggerAuctionEvent } from '@/lib/pusher'

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
    const { playerId } = body

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
    }

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
      return NextResponse.json({
        error: `Insufficient funds. Bidder has ₹${winningBidder.remainingPurse.toLocaleString('en-IN')} remaining, but bid amount is ₹${highestBid.amount.toLocaleString('en-IN')}.`
      }, { status: 400 })
    }

    // Enforce purse and squad-size feasibility at sale time as a safety net
    const rules = auction.rules as any
    const mandatoryTeamSize = Number(rules?.mandatoryTeamSize) || null
    const maxTeamSize = rules?.maxTeamSize ? Number(rules.maxTeamSize) : null
    const minPerPlayerReserve = Number(rules?.minPerPlayerReserve) || Number(rules?.minBidIncrement) || 0

    // OPTIMIZED: Count already-bought players with status filter for faster query
    const playersBoughtByBidder = await prisma.player.count({
      where: { 
        auctionId: params.id, 
        soldTo: winningBidder.id,
        status: 'SOLD' // Add status filter for faster indexed query
      }
    })

    if (maxTeamSize && playersBoughtByBidder + 1 > maxTeamSize) {
      return NextResponse.json({
        error: `Team size limit reached (max ${maxTeamSize}). Cannot acquire more players.`
      }, { status: 400 })
    }

    if (mandatoryTeamSize) {
      const remainingSlotsAfterThis = Math.max(mandatoryTeamSize - (playersBoughtByBidder + 1), 0)
      const requiredReserve = remainingSlotsAfterThis * minPerPlayerReserve
      const remainingAfterBid = winningBidder.remainingPurse - highestBid.amount
      if (remainingAfterBid < requiredReserve) {
        return NextResponse.json({
          error: `Sale would leave insufficient purse to complete mandatory squad of ${mandatoryTeamSize}. Required reserve: ₹${requiredReserve.toLocaleString('en-IN')}, remaining after sale: ₹${Math.max(remainingAfterBid, 0).toLocaleString('en-IN')}.`
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

    // Update player and bidder in parallel for better performance
    await Promise.all([
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
            isIcon: true
          }
        })
        
        availablePlayers = recycledPlayers
        
        // Broadcast players updated event to notify clients of recycled players
        triggerAuctionEvent(params.id, 'players-updated', {} as any).catch(err => console.error('Pusher error (non-critical):', err))
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
            auctionId: true
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

    // Broadcast new player if exists
    if (nextPlayer) {
      await triggerAuctionEvent(params.id, 'new-player', {
        player: nextPlayer
      } as any)

    // Reset timer
      const countdownSeconds = rules?.countdownSeconds || 30
      await triggerAuctionEvent(params.id, 'timer-update', {
        seconds: countdownSeconds
      } as any)
    }

    // Broadcast players updated event with data to avoid fetch (fire and forget)
    triggerAuctionEvent(params.id, 'players-updated', {
      players: [{
        ...currentPlayer,
        status: 'SOLD',
        soldTo: winningBidder.id,
        soldPrice: highestBid.amount
      }],
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

