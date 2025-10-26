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
      where: { id: params.id }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Mark any current player as UNSOLD if still AVAILABLE
    if (auction.currentPlayerId) {
      await prisma.player.updateMany({
        where: {
          id: auction.currentPlayerId,
          status: 'AVAILABLE'
        },
        data: { status: 'UNSOLD' }
      })
    }

    // Update status to COMPLETED
    await prisma.auction.update({
      where: { id: params.id },
      data: { status: 'COMPLETED' }
    })

    // Stop timer
    stopTimer(params.id)

    // Broadcast end event
    await triggerAuctionEvent(params.id, 'auction-ended', {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error ending auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

