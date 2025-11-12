import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { stopTimer } from '@/lib/auction-timer'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true,
        bidders: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Reset all players to AVAILABLE status and clear sale data
    await prisma.player.updateMany({
      where: { auctionId: params.id },
      data: {
        status: 'AVAILABLE',
        soldTo: null,
        soldPrice: null
      }
    })

    // Reset all bidders' remaining purse to their original purse amount
    // We need to do this per bidder since we can't reference the field directly in updateMany
    for (const bidder of auction.bidders) {
      await prisma.bidder.update({
        where: { id: bidder.id },
        data: {
          remainingPurse: bidder.purseAmount
        }
      })
    }

    // Reset auction state
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        status: 'DRAFT',
        currentPlayerId: null,
        bidHistory: []
      }
    })

    // Stop timer if running
    stopTimer(params.id)

    // Broadcast reset event
    await triggerAuctionEvent(params.id, 'auction-reset', {})

    return NextResponse.json({ success: true, message: 'Auction reset successfully' })
  } catch (error) {
    console.error('Error resetting auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

