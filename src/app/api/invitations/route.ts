import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

// Generate a random invitation code
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// GET: List all invitations for the current admin
export async function GET() {
  try {
    const session = await getServerSession()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const invitations = await prisma.invitation.findMany({
      orderBy: {
        createdAt: 'desc'
      },
      take: 50
    })

    return NextResponse.json({ invitations })
  } catch (error) {
    console.error('Error fetching invitations:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST: Create a new invitation code
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { expiresDays } = await request.json()
    
    // Generate unique code
    let code = generateCode()
    let exists = await prisma.invitation.findUnique({ where: { code } })
    
    // Ensure code is unique
    while (exists) {
      code = generateCode()
      exists = await prisma.invitation.findUnique({ where: { code } })
    }

    // Calculate expiration if provided
    const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000) : null

    const invitation = await prisma.invitation.create({
      data: {
        code,
        createdBy: session.user.id,
        expiresAt
      }
    })

    return NextResponse.json({ 
      invitation,
      message: 'Invitation code created successfully'
    })
  } catch (error) {
    console.error('Error creating invitation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

