import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

// PUT: Update a fixture
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; fixtureId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { matchName, team1Id, team2Id, matchDate, venue, status, result } = body

    // Check if fixture exists and belongs to this auction
    const existingFixture = await prisma.fixture.findUnique({
      where: { id: params.fixtureId },
      select: { auctionId: true }
    })

    if (!existingFixture) {
      return NextResponse.json(
        { error: 'Fixture not found' },
        { status: 404 }
      )
    }

    if (existingFixture.auctionId !== params.id) {
      return NextResponse.json(
        { error: 'Fixture does not belong to this auction' },
        { status: 400 }
      )
    }

    // If updating teams, validate them
    if (team1Id && team2Id) {
      const [team1, team2] = await Promise.all([
        prisma.bidder.findUnique({
          where: { id: team1Id },
          select: { auctionId: true }
        }),
        prisma.bidder.findUnique({
          where: { id: team2Id },
          select: { auctionId: true }
        })
      ])

      if (!team1 || !team2) {
        return NextResponse.json(
          { error: 'One or both teams not found' },
          { status: 404 }
        )
      }

      if (team1.auctionId !== params.id || team2.auctionId !== params.id) {
        return NextResponse.json(
          { error: 'Teams must belong to this auction' },
          { status: 400 }
        )
      }

      if (team1Id === team2Id) {
        return NextResponse.json(
          { error: 'Team 1 and Team 2 cannot be the same' },
          { status: 400 }
        )
      }
    }

    // Update fixture
    const updateData: any = {}
    if (matchName !== undefined) updateData.matchName = matchName
    if (team1Id !== undefined) updateData.team1Id = team1Id
    if (team2Id !== undefined) updateData.team2Id = team2Id
    if (matchDate !== undefined) updateData.matchDate = matchDate ? new Date(matchDate) : null
    if (venue !== undefined) updateData.venue = venue
    if (status !== undefined) updateData.status = status
    if (result !== undefined) updateData.result = result

    const fixture = await prisma.fixture.update({
      where: { id: params.fixtureId },
      data: updateData,
      include: {
        team1: {
          include: {
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        },
        team2: {
          include: {
            user: {
              select: {
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    return NextResponse.json({ fixture })
  } catch (error) {
    console.error('Error updating fixture:', error)
    return NextResponse.json(
      { error: 'Failed to update fixture' },
      { status: 500 }
    )
  }
}

// DELETE: Delete a fixture
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; fixtureId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if fixture exists and belongs to this auction
    const existingFixture = await prisma.fixture.findUnique({
      where: { id: params.fixtureId },
      select: { auctionId: true }
    })

    if (!existingFixture) {
      return NextResponse.json(
        { error: 'Fixture not found' },
        { status: 404 }
      )
    }

    if (existingFixture.auctionId !== params.id) {
      return NextResponse.json(
        { error: 'Fixture does not belong to this auction' },
        { status: 400 }
      )
    }

    // Delete fixture
    await prisma.fixture.delete({
      where: { id: params.fixtureId }
    })

    return NextResponse.json({ message: 'Fixture deleted successfully' })
  } catch (error) {
    console.error('Error deleting fixture:', error)
    return NextResponse.json(
      { error: 'Failed to delete fixture' },
      { status: 500 }
    )
  }
}

