import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { logEventAsync, describeError } from '@/lib/observability'

// Toggled from the dashboard's Presenter Link / Public Link actions when the
// live stage itself is broken (a crashed admin session, a venue connectivity
// outage) while the auction keeps running some other way - the built-in
// offline console, or an admin's own standalone tool. This is deliberately
// independent of `status`: the auction can still be LIVE (bidding is
// conceptually ongoing, just not through this screen) while the public view
// is told to stop relying on it. See isOfflineMode's read side in
// public-auction-view.tsx and the snapshot route.
const bodySchema = z.object({ enabled: z.boolean() })

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
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can change offline mode' }, { status: 403 })
    }

    await prisma.auction.update({
      where: { id: params.id },
      data: { isOfflineMode: parsed.data.enabled }
    })

    // Best-effort - a still-connected presenter/admin screen picks this up
    // instantly; every other viewer only sees it on their next manual
    // Refresh (see the snapshot route), same as every other update since
    // the public view's auto-poll was removed.
    triggerAuctionEvent(params.id, 'offline-mode-changed', { isOfflineMode: parsed.data.enabled })
      .catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ success: true, isOfflineMode: parsed.data.enabled })
  } catch (error) {
    console.error('Error toggling auction offline mode:', error)
    logEventAsync({ category: 'api_error', eventName: 'auction_offline_mode', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
