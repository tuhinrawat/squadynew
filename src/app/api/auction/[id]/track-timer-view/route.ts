import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isCuid } from '@/lib/slug'
import { Prisma } from '@prisma/client'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auctionIdOrSlug = params.id
    
    // Support both slug and ID
    const isId = isCuid(auctionIdOrSlug)
    
    // Find auction by ID or slug
    const auction = isId
      ? await prisma.auction.findUnique({
          where: { id: auctionIdOrSlug },
          select: { id: true, timerViews: true }
        })
      : await prisma.auction.findUnique({
          where: { slug: auctionIdOrSlug } as unknown as Prisma.AuctionWhereUniqueInput,
          select: { id: true, timerViews: true }
        })

    if (!auction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Increment timer views
    await prisma.auction.update({
      where: { id: auction.id },
      data: {
        timerViews: { increment: 1 }
      }
    })

    return NextResponse.json({
      success: true,
      timerViews: auction.timerViews + 1
    })
  } catch (error) {
    console.error('Error tracking timer view:', error)
    return NextResponse.json(
      { error: 'Failed to track timer view' },
      { status: 500 }
    )
  }
}

