import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/auctions/published - Fetch all published auctions
export async function GET(request: NextRequest) {
  try {
    const auctions = await prisma.auction.findMany({
      where: {
        isPublished: true,
        registrationOpen: true,
        status: {
          not: 'COMPLETED' // Exclude completed auctions
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
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
