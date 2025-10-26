import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()

    if (!code) {
      return NextResponse.json(
        { error: 'Invitation code is required' },
        { status: 400 }
      )
    }

    const invitation = await prisma.invitation.findUnique({
      where: { code: code.toUpperCase() }
    })

    if (!invitation) {
      return NextResponse.json(
        { error: 'Invalid invitation code' },
        { status: 404 }
      )
    }

    if (invitation.used) {
      return NextResponse.json(
        { error: 'This invitation code has already been used' },
        { status: 400 }
      )
    }

    // Check if expired
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      return NextResponse.json(
        { error: 'This invitation code has expired' },
        { status: 400 }
      )
    }

    return NextResponse.json({ 
      valid: true,
      code: invitation.code
    })
  } catch (error) {
    console.error('Error validating invitation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

