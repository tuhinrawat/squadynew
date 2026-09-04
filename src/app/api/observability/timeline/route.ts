import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { diagnose } from '@/lib/error-diagnosis'

// Everything the summary endpoint shows is sliced by category - Pusher
// events in one table, rate limits in another, failures in a third. During
// a real incident what you actually want is "show me everything that
// happened for this auction, in order" - one merged, chronological feed to
// correlate a rate-limit rejection against the sync-lag spike and the
// connection errors that followed it. This endpoint is that raw feed for a
// single auction, unaggregated.

const MAX_ROWS = 500

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const auctionId = searchParams.get('auctionId')
    if (!auctionId) {
      return NextResponse.json({ error: 'auctionId is required' }, { status: 400 })
    }

    // Most recent MAX_ROWS, then reversed to read oldest-first like a timeline.
    const rows = await prisma.observabilityEvent.findMany({
      where: { auctionId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true,
        category: true,
        eventName: true,
        success: true,
        latencyMs: true,
        message: true,
        metadata: true,
        createdAt: true,
      },
    })

    const events = rows.reverse().map(r => ({
      ...r,
      diagnosis: diagnose({ category: r.category, eventName: r.eventName, success: r.success, message: r.message, metadata: r.metadata as Record<string, unknown> | null, latencyMs: r.latencyMs }),
    }))

    return NextResponse.json({
      auctionId,
      truncated: rows.length === MAX_ROWS,
      events,
    })
  } catch (error) {
    console.error('Error building observability timeline:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
