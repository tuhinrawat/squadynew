import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'

// GET /api/auctions - Fetch all auctions for logged-in admin user
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const auctions = await prisma.auction.findMany({
      where: {
        createdById: session.user.id
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    })

    return NextResponse.json({ auctions })

  } catch (error) {
    console.error('Error fetching auctions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/auctions - Create new auction with rules stored in Json field
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { name, description, rules, isPublished, registrationOpen } = await request.json()

    // Validate input
    if (!name || !rules) {
      return NextResponse.json(
        { error: 'Name and rules are required' },
        { status: 400 }
      )
    }

    if (!rules.minBidIncrement || !rules.countdownSeconds) {
      return NextResponse.json(
        { error: 'minBidIncrement and countdownSeconds are required' },
        { status: 400 }
      )
    }

    // Verify user exists in database
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found. Please sign in again.' },
        { status: 404 }
      )
    }

    // Create auction
    const auction = await prisma.auction.create({
      data: {
        name,
        description: description || null,
        rules: rules as any, // Store as JSON
        isPublished: isPublished || false,
        registrationOpen: registrationOpen !== false, // Default to true
        createdById: session.user.id,
        status: 'DRAFT'
      },
      include: {
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    })

    return NextResponse.json({
      message: 'Auction created successfully',
      auction
    })

  } catch (error) {
    console.error('Error creating auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
