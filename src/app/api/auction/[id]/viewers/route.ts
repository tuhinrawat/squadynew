import { NextRequest, NextResponse } from 'next/server'
import { pusher } from '@/lib/pusher'

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

      // Broadcast new count to all viewers
      await pusher.trigger(`auction-${auctionId}`, 'viewer-count-update', {
        count: newCount
      })

      return NextResponse.json({ count: newCount })
    } else if (action === 'leave') {
      const currentCount = viewerCounts.get(auctionId) || 0
      const newCount = Math.max(0, currentCount - 1)
      viewerCounts.set(auctionId, newCount)

      // Broadcast new count to all viewers
      await pusher.trigger(`auction-${auctionId}`, 'viewer-count-update', {
        count: newCount
      })

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auctionId = params.id
  const count = viewerCounts.get(auctionId) || 0
  return NextResponse.json({ count })
}

