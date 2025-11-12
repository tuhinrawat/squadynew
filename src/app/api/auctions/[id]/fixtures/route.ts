import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

// GET: Fetch all fixtures for an auction
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const fixtures = await prisma.fixture.findMany({
      where: {
        auctionId: params.id
      },
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
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json({ fixtures })
  } catch (error) {
    console.error('Error fetching fixtures:', error)
    return NextResponse.json(
      { error: 'Failed to fetch fixtures' },
      { status: 500 }
    )
  }
}

// POST: Create a new fixture
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { matchName, team1Id, team2Id, matchDate, venue, status, result } = body

    // Validate required fields
    if (!matchName || !team1Id || !team2Id) {
      return NextResponse.json(
        { error: 'Match name, team 1, and team 2 are required' },
        { status: 400 }
      )
    }

    // Check if both teams exist and belong to this auction
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

    // Create fixture
    const fixture = await prisma.fixture.create({
      data: {
        auctionId: params.id,
        matchName,
        team1Id,
        team2Id,
        matchDate: matchDate ? new Date(matchDate) : null,
        venue,
        status: status || 'SCHEDULED',
        result
      },
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

    return NextResponse.json({ fixture }, { status: 201 })
  } catch (error) {
    console.error('Error creating fixture:', error)
    return NextResponse.json(
      { error: 'Failed to create fixture' },
      { status: 500 }
    )
  }
}

