import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createHash } from 'crypto'
import { recordView } from '@/lib/view-tracking'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auctionId = params.id
    const { visitorId } = await req.json()

    // Hash IP address for privacy
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const hashedIp = createHash('sha256').update(ipAddress).digest('hex').substring(0, 16)

    // Get user agent and referrer
    const userAgent = req.headers.get('user-agent') || undefined
    const referrer = req.headers.get('referer') || undefined

    // Check if auction exists
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      select: { id: true, totalViews: true, uniqueVisitors: true }
    })

    if (!auction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Check if this is a unique visitor (first time viewing)
    const existingView = await prisma.auctionView.findFirst({
      where: {
        auctionId,
        visitorId
      }
    })

    const isNewVisitor = !existingView

    // Record the view (durable per-view row - unchanged; this is the source
    // of truth for uniqueness above and for analytics that count view rows).
    await prisma.auctionView.create({
      data: {
        auctionId,
        visitorId,
        userAgent,
        ipAddress: hashedIp,
        referrer
      }
    })

    // Increment the running counters in Redis instead of taking a write lock
    // on the hot `auctions` row on every view (see lib/view-tracking.ts).
    // Redis is seeded from the current Postgres values, so the numbers
    // continue rather than reset, and are flushed back to Postgres
    // periodically. If Redis is unavailable, recordView returns null and we
    // fall back to the original Postgres increment so counts still move.
    const counters = await recordView(auctionId, isNewVisitor)

    if (counters) {
      return NextResponse.json({
        success: true,
        totalViews: counters.totalViews,
        uniqueVisitors: counters.uniqueVisitors
      })
    }

    // Fallback: Redis unavailable - preserve the original behaviour exactly.
    await prisma.auction.update({
      where: { id: auctionId },
      data: {
        totalViews: { increment: 1 },
        ...(isNewVisitor && { uniqueVisitors: { increment: 1 } })
      }
    })

    return NextResponse.json({
      success: true,
      totalViews: auction.totalViews + 1,
      uniqueVisitors: auction.uniqueVisitors + (isNewVisitor ? 1 : 0)
    })
  } catch (error) {
    console.error('Error tracking auction view:', error)
    return NextResponse.json(
      { error: 'Failed to track view' },
      { status: 500 }
    )
  }
}

