import { NextRequest, NextResponse } from 'next/server'
import { pusher } from '@/lib/pusher'
import { prisma } from '@/lib/prisma'
import { logEvent } from '@/lib/observability'

// A synthetic heartbeat, not a derivative of real bidder traffic. Every
// other signal in this system is passive - it only exists because a real
// bid or a real connected browser generated it. That means during the quiet
// minutes before an auction goes live, or on any auction with zero current
// viewers, the dashboard shows no data at all - indistinguishable from
// "healthy" and "silently broken." This endpoint fires a real Pusher trigger
// and a real DB round-trip on a schedule regardless of live traffic, so
// there is always at least one signal proving the pipe is actually open.
//
// Meant to be hit by a scheduled job (see .github/workflows/observability-cron.yml),
// not a human or the dashboard directly.

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.OBSERVABILITY_CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pusherStart = Date.now()
  let pusherLatencyMs: number | null = null
  let pusherOk = false
  let pusherError: string | undefined

  try {
    await pusher.trigger('observability-canary', 'heartbeat', { at: new Date().toISOString() })
    pusherLatencyMs = Date.now() - pusherStart
    pusherOk = true
  } catch (error) {
    pusherLatencyMs = Date.now() - pusherStart
    pusherError = error instanceof Error ? error.message : String(error)
  }

  const dbStart = Date.now()
  let dbLatencyMs: number | null = null
  let dbOk = false
  let dbError: string | undefined

  try {
    await prisma.$queryRaw`SELECT 1`
    dbLatencyMs = Date.now() - dbStart
    dbOk = true
  } catch (error) {
    dbLatencyMs = Date.now() - dbStart
    dbError = error instanceof Error ? error.message : String(error)
  }

  const success = pusherOk && dbOk
  await logEvent({
    category: 'canary',
    eventName: 'heartbeat',
    success,
    latencyMs: Math.max(pusherLatencyMs ?? 0, dbLatencyMs ?? 0),
    message: success ? undefined : [pusherError, dbError].filter(Boolean).join('; '),
    metadata: { pusherOk, pusherLatencyMs, dbOk, dbLatencyMs },
  })

  return NextResponse.json({ success, pusherOk, pusherLatencyMs, dbOk, dbLatencyMs })
}
