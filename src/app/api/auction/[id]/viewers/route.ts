import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { viewerJoin, viewerLeave, viewerGet } from '@/lib/view-tracking'

// Live viewer count. Backed by Redis (shared across all serverless instances)
// with the SAME join/leave/get contract and response shape as before. The
// previous implementation kept the count in a per-process in-memory Map, which
// on Vercel's many function instances was fragmented and undercounted; Redis
// makes it correct without changing the API.
//
// Fallback: if Redis is unavailable, we drop back to the original in-memory
// Map so behaviour degrades to exactly what it was before, never errors.
const viewerCounts = new Map<string, number>()

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { action } = await request.json()
    const auctionId = params.id

    if (action === 'join') {
      const redisCount = await viewerJoin(auctionId)
      if (redisCount !== null) {
        return NextResponse.json({ count: redisCount })
      }

      // Fallback: in-memory Map (original behaviour, incl. peak update).
      const currentCount = viewerCounts.get(auctionId) || 0
      const newCount = currentCount + 1
      viewerCounts.set(auctionId, newCount)
      try {
        const auction = await prisma.auction.findUnique({
          where: { id: auctionId },
          select: { peakViewers: true }
        })
        if (auction && newCount > auction.peakViewers) {
          await prisma.auction.update({
            where: { id: auctionId },
            data: { peakViewers: newCount }
          })
        }
      } catch (err) {
        console.error('Failed to update peak viewers:', err)
      }
      return NextResponse.json({ count: newCount })
    } else if (action === 'leave') {
      const redisCount = await viewerLeave(auctionId)
      if (redisCount !== null) {
        return NextResponse.json({ count: redisCount })
      }

      // Fallback: in-memory Map.
      const currentCount = viewerCounts.get(auctionId) || 0
      const newCount = Math.max(0, currentCount - 1)
      viewerCounts.set(auctionId, newCount)
      return NextResponse.json({ count: newCount })
    } else if (action === 'get') {
      const redisCount = await viewerGet(auctionId)
      if (redisCount !== null) {
        return NextResponse.json({ count: redisCount })
      }
      // Fallback: in-memory Map.
      const count = viewerCounts.get(auctionId) || 0
      return NextResponse.json({ count })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error managing viewer count:', error)
    return NextResponse.json(
      { error: 'Failed to update viewer count' },
      { status: 500 }
    )
  }
}

// Polled by useViewerCount on an interval (not Pusher - see that hook for
// why). Short edge cache so many viewers polling the same auction within
// the same few seconds collapse into ~one real read, the same tradeoff the
// snapshot endpoint makes.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auctionId = params.id
  const redisCount = await viewerGet(auctionId)
  const count = redisCount !== null ? redisCount : (viewerCounts.get(auctionId) || 0)
  return NextResponse.json(
    { count },
    { headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' } }
  )
}
