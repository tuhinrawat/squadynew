import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { pusher } from '@/lib/pusher'

export const dynamic = 'force-dynamic'

// Advanced rate limiting with sliding window
class RateLimiter {
  private timestamps: Map<string, number[]> = new Map()
  private readonly windowMs: number
  private readonly maxRequests: number
  private cleanupInterval: NodeJS.Timeout

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
    
    // Cleanup old entries every minute to prevent memory leak
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000)
  }

  check(key: string): { allowed: boolean; remaining: number } {
    const now = Date.now()
    const userTimestamps = this.timestamps.get(key) || []
    
    // Remove timestamps outside the window
    const recentTimestamps = userTimestamps.filter(t => now - t < this.windowMs)
    
    if (recentTimestamps.length >= this.maxRequests) {
      this.timestamps.set(key, recentTimestamps)
      return { allowed: false, remaining: 0 }
    }
    
    // Add current timestamp
    recentTimestamps.push(now)
    this.timestamps.set(key, recentTimestamps)
    
    return { 
      allowed: true, 
      remaining: this.maxRequests - recentTimestamps.length 
    }
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of this.timestamps.entries()) {
      const recent = timestamps.filter(t => now - t < this.windowMs)
      if (recent.length === 0) {
        this.timestamps.delete(key)
      } else {
        this.timestamps.set(key, recent)
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval)
  }
}

// Separate rate limiters for messages and reactions
const messageRateLimiter = new RateLimiter(30000, 15) // 15 messages per 30 seconds
const reactionRateLimiter = new RateLimiter(20000, 100) // 100 reactions per 20 seconds (more lenient for quick tapping)

// Message deduplication cache (prevent double-sends)
const messageCache = new Map<string, number>()
const MESSAGE_CACHE_TTL = 5000 // 5 seconds

// Cleanup message cache periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, timestamp] of messageCache.entries()) {
    if (now - timestamp > MESSAGE_CACHE_TTL) {
      messageCache.delete(key)
    }
  }
}, 10000)

// Input sanitization
function sanitizeInput(input: string, maxLength: number): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove potential XSS vectors
    .replace(/\s+/g, ' ') // Normalize whitespace
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auctionId = params.id

    // Optimized query with minimal data selection
    const messages = await prisma.chatMessage.findMany({
      where: { auctionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        username: true,
        userId: true,
        message: true,
        createdAt: true
      }
    })

    return NextResponse.json({ 
      messages: messages.reverse(),
      count: messages.length 
    })
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
    const body = await request.json()
    const { username, userId, message, emoji } = body

    // Handle emoji reactions (lightweight, no DB write)
    if (emoji) {
      if (!username || !userId) {
        return NextResponse.json(
          { error: 'Username and userId required for reactions' },
          { status: 400 }
        )
      }

      // Rate limit reactions
      const userKey = `reaction-${auctionId}-${userId}`
      const rateLimitResult = reactionRateLimiter.check(userKey)
      
      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { error: 'Too many reactions. Please slow down!', remaining: 0 },
          { status: 429 }
        )
      }

      // Broadcast reaction (fire and forget - no await for speed)
      pusher.trigger(`auction-${auctionId}`, 'emoji-reaction', {
        emoji,
        username: sanitizeInput(username, 50),
        userId,
        timestamp: Date.now()
      }).catch(err => console.error('Pusher error:', err))

      return NextResponse.json({ 
        success: true, 
        remaining: rateLimitResult.remaining 
      })
    }

    // Handle chat messages
    if (!username || !message) {
      return NextResponse.json(
        { error: 'Username and message are required' },
        { status: 400 }
      )
    }

    // Sanitize inputs
    const trimmedUsername = sanitizeInput(username, 50)
    const trimmedUserId = userId?.trim() || null
    const trimmedMessage = sanitizeInput(message, 500)

    if (!trimmedUsername || !trimmedMessage || trimmedMessage.length < 1) {
      return NextResponse.json(
        { error: 'Invalid username or message' },
        { status: 400 }
      )
    }

    // Deduplication check (prevent accidental double-sends)
    const messageHash = `${auctionId}-${trimmedUserId || trimmedUsername}-${trimmedMessage}`
    const lastSent = messageCache.get(messageHash)
    if (lastSent && Date.now() - lastSent < MESSAGE_CACHE_TTL) {
      return NextResponse.json(
        { error: 'Duplicate message detected', duplicate: true },
        { status: 429 }
      )
    }

    // Rate limiting for messages
    const userKey = `message-${auctionId}-${trimmedUserId || trimmedUsername}`
    const rateLimitResult = messageRateLimiter.check(userKey)
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many messages. Please slow down!', remaining: 0 },
        { status: 429 }
      )
    }

    // Cache this message to prevent duplicates
    messageCache.set(messageHash, Date.now())

    // Verify auction exists and is active (single query)
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

    if (auction.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Chat is closed for completed auctions' },
        { status: 403 }
      )
    }

    // Create chat message (optimized)
    const chatMessage = await prisma.chatMessage.create({
      data: {
        auctionId,
        username: trimmedUsername,
        userId: trimmedUserId,
        message: trimmedMessage
      },
      select: {
        id: true,
        username: true,
        userId: true,
        message: true,
        createdAt: true
      }
    })

    // Broadcast to all viewers (fire and forget for speed)
    pusher.trigger(`auction-${auctionId}`, 'new-chat-message', {
      id: chatMessage.id,
      username: chatMessage.username,
      userId: chatMessage.userId,
      message: chatMessage.message,
      createdAt: chatMessage.createdAt
    }).catch(err => console.error('Pusher error:', err))

    return NextResponse.json({ 
      message: chatMessage,
      remaining: rateLimitResult.remaining
    })
  } catch (error: any) {
    console.error('Error in chat API:', error)
    
    // Handle specific error types
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Duplicate message' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}

