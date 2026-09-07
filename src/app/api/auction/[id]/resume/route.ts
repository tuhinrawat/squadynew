import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
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

    const auction = await prisma.auction.findUnique({
      where: { id: params.id }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Security: role alone isn't ownership - without this, any ADMIN
    // account could resume a different admin's auction.
    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can resume it' }, { status: 403 })
    }

    if (auction.status !== 'PAUSED') {
      return NextResponse.json({ error: 'Auction is not paused' }, { status: 400 })
    }

    // Update status to LIVE
    await prisma.auction.update({
      where: { id: params.id },
      data: { status: 'LIVE' }
    })

    // Broadcast resume event - the DB already moved to LIVE above, so a
    // Pusher hiccup here must never turn that success into a 500.
    await triggerAuctionEvent(params.id, 'auction-resumed', {}).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error resuming auction:', error)
    logEventAsync({ category: 'api_error', eventName: 'auction_resume', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

