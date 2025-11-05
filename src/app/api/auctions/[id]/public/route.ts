import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/auctions/[id]/public - Get auction data without authentication
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true,
        bidders: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    return NextResponse.json({ auction })
  } catch (error) {
    console.error('Error fetching public auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
