import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { isLiveStatus } from '@/lib/auction-status'
import { logEventAsync } from '@/lib/observability'

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

    if (!isLiveStatus(auction.status)) {
      return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
    }

    // Update status to PAUSED
    await prisma.auction.update({
      where: { id: params.id },
      data: { status: 'PAUSED' }
    })

    // Broadcast pause event
    await triggerAuctionEvent(params.id, 'auction-paused', {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error pausing auction:', error)
    logEventAsync({ category: 'api_error', eventName: 'auction_pause', auctionId: params.id, success: false, message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

