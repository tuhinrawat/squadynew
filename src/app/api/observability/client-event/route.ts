import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { RateLimiter } from '@/lib/rate-limiter'
import { logEventAsync } from '@/lib/observability'

// Public, unauthenticated by necessity - every bidder and viewer's browser
// reports here, not just admins. That means: strict payload validation (no
// free-form fields beyond a short message), a rate limit per IP so one
// misbehaving client can't flood the table, and every write already goes
// through logEventAsync's swallow-all error handling - a bad report here
// must never surface to the reporting browser as a real error.
//
// This is the one layer only the client can measure: how long it actually
// took for an update to reach a real bidder's screen, and whether their
// Pusher subscription is actually healthy right now - both invisible from
// the server side.

const clientEventSchema = z.object({
  auctionId: z.string().trim().min(1).max(100),
  eventName: z.enum(['sync_lag', 'connected', 'connection_error', 'rebind']),
  latencyMs: z.coerce.number().nonnegative().max(600000).optional(),
  message: z.string().trim().max(300).optional(),
})

// Generous enough for real usage (a busy bidding war can mean several
// new-bid receipts per minute per open tab) while still bounding a
// misbehaving or malicious client.
const clientEventRateLimiter = new RateLimiter(10000, 60) // 60 reports per 10s per IP

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = clientEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!clientEventRateLimiter.check(`client-event-${ip}`).allowed) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
    }

    const { auctionId, eventName, latencyMs, message } = parsed.data
    logEventAsync({
      category: eventName === 'sync_lag' ? 'sync_lag' : 'pusher_client',
      eventName,
      auctionId,
      success: eventName !== 'connection_error',
      latencyMs,
      message,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error recording client event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
