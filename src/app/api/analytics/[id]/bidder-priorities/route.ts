import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { isCuid } from '@/lib/slug'
import { Prisma } from '@prisma/client'

// GET /api/analytics/[id]/bidder-priorities - Get bidder priority matrix
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Support both slug and ID
    const isId = isCuid(params.id)
    const auction = isId
      ? await prisma.auction.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            rules: true
          }
        })
      : await prisma.auction.findUnique({
          where: { slug: params.id } as unknown as Prisma.AuctionWhereUniqueInput,
          select: {
            id: true,
            rules: true
          }
        })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const rules = auction.rules as any
    const bidderPriorities = rules?.bidderPriorities || {}
    const playerOrder = rules?.playerOrder || []

    return NextResponse.json({ bidderPriorities, playerOrder })
  } catch (error) {
    console.error('Error fetching bidder priorities:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/analytics/[id]/bidder-priorities - Update bidder priority matrix
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    // Allow access with special key or admin authentication
    const { key, bidderPriorities, playerOrder } = await request.json()

    if (key !== 'tushkiKILLS' && (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!bidderPriorities || typeof bidderPriorities !== 'object') {
      return NextResponse.json({ error: 'Invalid bidder priorities data' }, { status: 400 })
    }

    // Support both slug and ID
    const isId = isCuid(params.id)
    const auction = isId
      ? await prisma.auction.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            rules: true
          }
        })
      : await prisma.auction.findUnique({
          where: { slug: params.id } as unknown as Prisma.AuctionWhereUniqueInput,
          select: {
            id: true,
            rules: true
          }
        })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Update rules with bidder priorities and player order
    const rules = (auction.rules as any) || {}
    rules.bidderPriorities = bidderPriorities
    
    // Save player order if provided (array of player names)
    if (playerOrder && Array.isArray(playerOrder)) {
      rules.playerOrder = playerOrder
    }

    await prisma.auction.update({
      where: { id: auction.id }, // Use auction.id (always use ID for updates)
      data: {
        rules: rules as any
      }
    })

    return NextResponse.json({ 
      success: true,
      message: 'Bidder priorities and player order updated successfully'
    })
  } catch (error) {
    console.error('Error updating bidder priorities:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

