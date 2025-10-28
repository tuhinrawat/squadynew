import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { pusher } from '@/lib/pusher'

export const dynamic = 'force-dynamic' // Ensure dynamic rendering

// Simple in-memory rate limiter (in production, use Redis)
const messageTimestamps = new Map<string, number[]>()
const RATE_LIMIT_WINDOW = 10000 // 10 seconds
const MAX_MESSAGES_PER_WINDOW = 3 // Max 3 messages per 10 seconds

// Cleanup old entries periodically to prevent memory leak
setInterval(() => {
  const now = Date.now()
  for (const [key, timestamps] of messageTimestamps.entries()) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
    if (recent.length === 0) {
      messageTimestamps.delete(key)
    } else {
      messageTimestamps.set(key, recent)
    }
  }
}, 60000) // Clean every minute

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auctionId = params.id

    // Get recent messages (last 50) - optimized with index
    const messages = await prisma.chatMessage.findMany({
      where: { auctionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        username: true,
        message: true,
        createdAt: true
      }
    })

    // Return in ascending order for display
    return NextResponse.json({ messages: messages.reverse() })
  } catch (error) {
    console.error('Error fetching chat messages:', error)
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auctionId = params.id
    const { username, message } = await request.json()

    if (!username || !message) {
      return NextResponse.json(
        { error: 'Username and message are required' },
        { status: 400 }
      )
    }

    // Trim and validate
    const trimmedUsername = username.trim().slice(0, 50)
    const trimmedMessage = message.trim().slice(0, 500)

    if (!trimmedUsername || !trimmedMessage) {
      return NextResponse.json(
        { error: 'Invalid username or message' },
        { status: 400 }
      )
    }

    // Rate limiting check
    const userKey = `${auctionId}-${trimmedUsername}`
    const now = Date.now()
    const userTimestamps = messageTimestamps.get(userKey) || []
    
    // Remove timestamps outside the window
    const recentTimestamps = userTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
    
    if (recentTimestamps.length >= MAX_MESSAGES_PER_WINDOW) {
      return NextResponse.json(
        { error: 'Too many messages. Please slow down!' },
        { status: 429 }
      )
    }
    
    // Add current timestamp
    recentTimestamps.push(now)
    messageTimestamps.set(userKey, recentTimestamps)

    // Check if auction exists
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      select: { status: true }
    })

    if (!auction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Don't allow chat in completed auctions
    if (auction.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Chat is closed for completed auctions' },
        { status: 403 }
      )
    }

    // Create chat message
    const chatMessage = await prisma.chatMessage.create({
      data: {
        auctionId,
        username: trimmedUsername,
        message: trimmedMessage
      }
    })

    // Broadcast to all viewers via Pusher
    await pusher.trigger(`auction-${auctionId}`, 'new-chat-message', {
      id: chatMessage.id,
      username: chatMessage.username,
      message: chatMessage.message,
      createdAt: chatMessage.createdAt
    })

    return NextResponse.json({ message: chatMessage })
  } catch (error: any) {
    console.error('Error sending chat message:', error)
    console.error('Error details:', error.message, error.stack)
    return NextResponse.json(
      { error: 'Failed to send message', details: error.message },
      { status: 500 }
    )
  }
}

