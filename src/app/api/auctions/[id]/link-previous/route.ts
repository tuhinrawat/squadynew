import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { computeLastYearMatches } from '@/lib/auction-history'

// GET: the auctions this auction is currently linked to, plus every other
// COMPLETED auction owned by this user that could be linked (the dashboard's
// picker needs both to render pre-checked boxes).
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auctionId = params.id
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId, createdById: session.user.id },
      select: { id: true },
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const [links, candidates] = await Promise.all([
      prisma.auctionLink.findMany({
        where: { auctionId },
        select: { linkedAuctionId: true },
      }),
      prisma.auction.findMany({
        where: {
          createdById: session.user.id,
          status: 'COMPLETED',
          id: { not: auctionId },
        },
        select: { id: true, name: true, scheduledStartDate: true, createdAt: true },
        orderBy: [{ scheduledStartDate: 'desc' }, { createdAt: 'desc' }],
      }),
    ])

    return NextResponse.json({
      linkedAuctionIds: links.map(l => l.linkedAuctionId),
      candidates,
    })
  } catch (error) {
    console.error('Error fetching linked auctions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const linkPreviousSchema = z.object({
  linkedAuctionIds: z.array(z.string().trim().min(1)),
})

// POST: replaces this auction's linked-previous-auctions set and recomputes
// every player's lastYear* snapshot from it.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auctionId = params.id
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId, createdById: session.user.id },
      select: { id: true },
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = linkPreviousSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'linkedAuctionIds must be an array of auction ids' }, { status: 400 })
    }

    const requestedIds = [...new Set(parsed.data.linkedAuctionIds)].filter(id => id !== auctionId)

    // Only auctions this user owns and that are actually COMPLETED can be
    // linked in as "previous" - a live or draft auction's data isn't final.
    const validAuctions = requestedIds.length > 0
      ? await prisma.auction.findMany({
          where: { id: { in: requestedIds }, createdById: session.user.id, status: 'COMPLETED' },
          select: { id: true },
        })
      : []
    const validIds = validAuctions.map(a => a.id)

    await prisma.$transaction([
      prisma.auctionLink.deleteMany({
        where: { auctionId, linkedAuctionId: { notIn: validIds } },
      }),
      ...validIds.map(linkedAuctionId =>
        prisma.auctionLink.upsert({
          where: { auctionId_linkedAuctionId: { auctionId, linkedAuctionId } },
          create: { auctionId, linkedAuctionId },
          update: {},
        })
      ),
    ])

    const { matchedCount, totalPlayers } = await computeLastYearMatches(auctionId, validIds)

    return NextResponse.json({ linkedAuctionIds: validIds, matchedCount, totalPlayers })
  } catch (error) {
    console.error('Error linking previous auctions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
