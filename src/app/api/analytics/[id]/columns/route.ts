import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// PUT /api/analytics/[id]/columns - Update analytics visible columns (no auth required, uses special key)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { analyticsVisibleColumns } = await request.json()

    if (!analyticsVisibleColumns || !Array.isArray(analyticsVisibleColumns)) {
      return NextResponse.json(
        { error: 'analyticsVisibleColumns must be an array' },
        { status: 400 }
      )
    }

    // Check if auction exists
    const existingAuction = await prisma.auction.findUnique({
      where: {
        id: params.id
      }
    })

    if (!existingAuction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Update analytics visible columns
    const auction = await prisma.auction.update({
      where: {
        id: params.id
      },
      data: {
        analyticsVisibleColumns: analyticsVisibleColumns
      }
    })

    return NextResponse.json({
      message: 'Analytics columns updated successfully',
      analyticsVisibleColumns: auction.analyticsVisibleColumns
    })

  } catch (error) {
    console.error('Error updating analytics columns:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

