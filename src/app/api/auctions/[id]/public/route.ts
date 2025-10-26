import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/auctions/[id]/public - Get auction details for public registration
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        isPublished: true
      },
      select: {
        id: true,
        name: true,
        description: true,
        customFields: true,
        registrationOpen: true,
        status: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    return NextResponse.json({ auction })
  } catch (error) {
    console.error('Error fetching auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
