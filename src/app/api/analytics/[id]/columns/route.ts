import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isCuid } from '@/lib/slug'
import { Prisma } from '@prisma/client'

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

    // Support both slug and ID
    const isId = isCuid(params.id)
    const existingAuction = isId
      ? await prisma.auction.findUnique({
          where: { id: params.id }
        })
      : await prisma.auction.findUnique({
          where: { slug: params.id } as unknown as Prisma.AuctionWhereUniqueInput
        })

    if (!existingAuction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Update analytics visible columns (always use ID for updates)
    const auction = await prisma.auction.update({
      where: {
        id: existingAuction.id
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

