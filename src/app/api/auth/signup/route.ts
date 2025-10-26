import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { name, email, password, invitationCode } = await request.json()

    // Validate input
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    // Check invitation code
    if (!invitationCode) {
      return NextResponse.json(
        { error: 'Invitation code is required' },
        { status: 400 }
      )
    }

    // Validate invitation code
    const invitation = await prisma.invitation.findUnique({
      where: { code: invitationCode.toUpperCase() }
    })

    if (!invitation) {
      return NextResponse.json(
        { error: 'Invalid invitation code' },
        { status: 400 }
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      )
    }

    // Validate password length
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 }
      )
    }

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: 'ADMIN' // All signups are ADMIN by default
      }
    })

    // Mark invitation as used
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        used: true,
        usedBy: user.id,
        usedAt: new Date()
      }
    })

    // Return success (don't return password)
    return NextResponse.json({
      message: 'User created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    })

  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
