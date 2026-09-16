import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

// POST /api/auctions/[id]/players/assign-serial-numbers
//
// Randomly assigns a permanent 1..N number to every non-retired player in
// this auction, where N is the number of non-retired players - the number
// printed on the physical plaque the team hands the winning bidder. A
// player who already has one is never touched (re-running this after
// uploading more players, or retiring a few more, only fills in the ones
// that still have none) - "permanent once assigned" is the whole point.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findFirst({
      where: { id: params.id, createdById: session.user.id },
      select: { id: true, status: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Same editability rule the rest of Manage Players enforces - assigning
    // numbers mid-auction would be confusing (players already sold/on the
    // block suddenly gaining a number) rather than genuinely useful.
    if (auction.status === 'LIVE' || auction.status === 'MOCK_RUN') {
      return NextResponse.json(
        { error: 'Cannot assign serial numbers while the auction is LIVE or in MOCK_RUN mode' },
        { status: 400 }
      )
    }

    const players = await prisma.player.findMany({
      where: { auctionId: params.id },
      select: { id: true, status: true, serialNumber: true }
    })

    const nonRetired = players.filter(p => p.status !== 'RETIRED')
    const needsNumber = nonRetired.filter(p => p.serialNumber == null)

    if (needsNumber.length === 0) {
      return NextResponse.json({
        success: true,
        assignedCount: 0,
        alreadyAssignedCount: nonRetired.length,
        totalEligible: nonRetired.length,
        message: 'Every non-retired player already has a serial number.'
      })
    }

    // The number range is 1..N (N = total non-retired players), skipping
    // any number already in use by ANY player (including a since-retired
    // one that still carries a stale number) - defensive, since a number
    // this route already handed out must never be handed out twice. If
    // that ever leaves fewer free numbers within 1..N than players still
    // needing one (only possible if retirements shrank N after an earlier
    // run), the range extends past N rather than colliding or crashing.
    const usedNumbers = new Set(
      players.map(p => p.serialNumber).filter((n): n is number => n != null)
    )
    const n = nonRetired.length
    const pool: number[] = []
    for (let i = 1; pool.length < needsNumber.length; i++) {
      if (i > n * 2 + needsNumber.length) break // sanity bound, should never hit
      if (!usedNumbers.has(i)) pool.push(i)
    }

    // Fisher-Yates shuffle so the numbers land on players in random order.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }

    const rows = needsNumber.map((player, index) =>
      Prisma.sql`(${player.id}::text, ${pool[index]}::integer)`
    )

    // One batched UPDATE...FROM(VALUES...) instead of one round-trip per
    // player - each player gets a different number, so this can't collapse
    // into a single WHERE-scoped updateMany.
    await prisma.$executeRaw`
      UPDATE players AS p
      SET "serialNumber" = v.number
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, number)
      WHERE p.id = v.id
    `

    return NextResponse.json({
      success: true,
      assignedCount: needsNumber.length,
      alreadyAssignedCount: nonRetired.length - needsNumber.length,
      totalEligible: nonRetired.length
    })
  } catch (error) {
    console.error('Error assigning serial numbers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
