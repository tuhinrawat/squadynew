import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Get the most recently sold player
    const soldPlayers = auction.players.filter(p => p.status === 'SOLD')
    if (soldPlayers.length === 0) {
      return NextResponse.json({ error: 'No sold players to undo' }, { status: 400 })
    }

    // Get the last sold player ordered by when it was sold (not createdAt, need updatedAt)
    const lastSoldPlayer = await prisma.player.findFirst({
      where: {
        auctionId: params.id,
        status: 'SOLD'
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })

    if (!lastSoldPlayer || !lastSoldPlayer.soldTo || !lastSoldPlayer.soldPrice) {
      return NextResponse.json({ error: 'Invalid sale data' }, { status: 400 })
    }

    // Get the bidder who purchased
    const bidder = await prisma.bidder.findUnique({
      where: { id: lastSoldPlayer.soldTo }
    })

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Parse bid history to restore previous state
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    // Get the bids for this player (they should still be in history before undo)
    const playerBids = bidHistory.filter(bid => {
      // We need to track which bids were for which player
      // This requires storing playerId in bid history
      // For now, we'll keep the last bid from history before the sale
      return true
    })

    // Revert the sale
    await prisma.$transaction([
      prisma.player.update({
        where: { id: lastSoldPlayer.id },
        data: {
          status: 'AVAILABLE',
          soldTo: null,
          soldPrice: null,
          updatedAt: new Date()
        }
      }),
      prisma.bidder.update({
        where: { id: bidder.id },
        data: {
          remainingPurse: bidder.remainingPurse + lastSoldPlayer.soldPrice
        }
      }),
      prisma.auction.update({
        where: { id: params.id },
        data: {
          currentPlayerId: lastSoldPlayer.id,
          // Keep the bid history as is (it should still have the bids for this player)
        }
      })
    ])

    // Broadcast sale undo event
    await triggerAuctionEvent(params.id, 'sale-undo', {
      playerId: lastSoldPlayer.id
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error undoing sale:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

