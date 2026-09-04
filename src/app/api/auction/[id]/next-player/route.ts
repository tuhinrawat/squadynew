import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { isLiveStatus } from '@/lib/auction-status'
import { logEventAsync, describeError } from '@/lib/observability'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only status/isIcon are needed to pick the next player - the winning
    // candidate's full `data` is fetched separately, once, after selection
    // (matching mark-sold/mark-unsold's pattern), instead of pulling every
    // player's full JSON blob just to run this selection logic.
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        currentPlayerId: true,
        players: {
          select: { id: true, status: true, isIcon: true }
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    if (!isLiveStatus(auction.status)) {
      return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
    }

    // Mark current player as UNSOLD if it's still AVAILABLE
    if (auction.currentPlayerId) {
      const currentPlayer = auction.players.find(p => p.id === auction.currentPlayerId)
      if (currentPlayer && currentPlayer.status === 'AVAILABLE') {
        await prisma.player.update({
          where: { id: currentPlayer.id },
          data: { status: 'UNSOLD' }
        })
      }
    }

    // Pick next random available player
    // Prioritize icon players if they haven't all been auctioned yet
    let availablePlayers = auction.players.filter(p => p.status === 'AVAILABLE')

    // If no available players, automatically recycle UNSOLD players back to AVAILABLE
    // IMPORTANT: Only recycle UNSOLD players, NEVER recycle SOLD players
    if (availablePlayers.length === 0) {
      // Explicitly filter for UNSOLD players only - SOLD players should NEVER be recycled
      const unsoldPlayers = auction.players.filter(p => p.status === 'UNSOLD')
      
      // Additional safety check: ensure no SOLD players are accidentally included
      const soldPlayers = auction.players.filter(p => p.status === 'SOLD')
      if (soldPlayers.length > 0 && unsoldPlayers.some(p => soldPlayers.find(sp => sp.id === p.id))) {
        console.error('CRITICAL: Attempted to recycle SOLD players - this should never happen!')
        logEventAsync({ category: 'api_error', eventName: 'next_player', auctionId: params.id, success: false, message: 'CRITICAL: recycle-guard tripped - a SOLD player appeared in the UNSOLD recycling pool', metadata: { guard: 'recycle_sold_players' } })
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
        
        // Refresh auction data after conversion
        const updatedAuction = await prisma.auction.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            players: {
              select: { id: true, status: true, isIcon: true }
            }
          }
        })
        
        if (updatedAuction) {
          availablePlayers = updatedAuction.players.filter(p => p.status === 'AVAILABLE')
          
          // Broadcast players updated event to notify clients of recycled players
          triggerAuctionEvent(params.id, 'players-updated', {} as any).catch(err => console.error('Pusher error (non-critical):', err))
        }
      }
    }
    
    if (availablePlayers.length === 0) {
      return NextResponse.json({ error: 'No more players available' }, { status: 400 })
    }

    // ICON PLAYERS MUST BE AUCTIONED FIRST
    // Only show regular players after ALL icon players have been auctioned (SOLD or UNSOLD)
    const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
    
    let randomPlayer

    if (iconPlayersAvailable.length > 0) {
      // There are still icon players available - MUST select from icon players only
      // Regular players cannot be shown until all icon players are processed
      randomPlayer = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)]
    } else {
      // All icon players have been processed (either SOLD or UNSOLD and not yet recycled)
      // Now we can show regular players
      const regularPlayersAvailable = availablePlayers.filter(p => !p.isIcon)
      if (regularPlayersAvailable.length > 0) {
        randomPlayer = regularPlayersAvailable[Math.floor(Math.random() * regularPlayersAvailable.length)]
      }
    }
    
    if (!randomPlayer) {
      return NextResponse.json({ error: 'No more players available' }, { status: 400 })
    }

    // Update auction with new current player
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        currentPlayerId: randomPlayer.id,
        bidHistory: []
      }
    })

    // The selection above only carries id/status/isIcon - fetch the full
    // record (with `data`) for just this one chosen player, now that we
    // know which one it is, instead of having pulled every player's full
    // JSON blob up front to make the selection.
    const fullNextPlayer = await prisma.player.findUnique({
      where: { id: randomPlayer.id },
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

    // No automatic sale when timer expires - admin decides

    // Broadcast new player event - the DB already moved to this player
    // above, so a Pusher hiccup here must never turn that success into a 500.
    await triggerAuctionEvent(params.id, 'new-player', { player: fullNextPlayer }).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ success: true, player: fullNextPlayer })
  } catch (error) {
    console.error('Error moving to next player:', error)
    logEventAsync({ category: 'api_error', eventName: 'next_player', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


