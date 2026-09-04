import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'

// GET /api/auctions/published - Fetch all published auctions
export async function GET(request: NextRequest) {
  try {
    const auctions = await prisma.auction.findMany({
      where: {
        isPublished: true,
        registrationOpen: true,
        status: {
          notIn: ['COMPLETED', 'MOCK_RUN'] // Exclude completed and mock run auctions
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      // A defensive cap - this is public, platform-wide, unauthenticated
      // data with no per-user scoping, so it grows with total auctions on
      // the platform rather than with any one customer's usage.
      take: 100,
      // This route's own HTTP Cache-Control already collapses concurrent
      // edge requests, but a cache miss (cold edge region, direct hit)
      // still means a live Postgres query - Accelerate's own response cache
      // makes even that miss cheap. Public, non-bid-critical data is
      // exactly what this is safe for; never applied to anything on the
      // live-bidding path (current bid, purse, roster state), which must
      // always be read fresh.
      cacheStrategy: { ttl: 30, swr: 60 },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        image: true,
        status: true,
        registrationOpen: true,
        scheduledStartDate: true,
        rules: true,
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    })

    // Add caching headers for better performance - public data can be cached longer
    const response = NextResponse.json({ auctions })
    response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
    
    return response
  } catch (error) {
    console.error('Error fetching published auctions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
