import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// In-memory store for viewer counts (in production, use Redis)
const viewerCounts = new Map<string, number>()

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { action } = await request.json()
    const auctionId = params.id

    if (action === 'join') {
      const currentCount = viewerCounts.get(auctionId) || 0
      const newCount = currentCount + 1
      viewerCounts.set(auctionId, newCount)

      // Update peak viewers if this is a new peak
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
      const currentCount = viewerCounts.get(auctionId) || 0
      const newCount = Math.max(0, currentCount - 1)
      viewerCounts.set(auctionId, newCount)

      return NextResponse.json({ count: newCount })
    } else if (action === 'get') {
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
// the same few seconds collapse into ~one real read of this instance's map,
// the same tradeoff the snapshot endpoint makes.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auctionId = params.id
  const count = viewerCounts.get(auctionId) || 0
  return NextResponse.json(
    { count },
    { headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' } }
  )
}

