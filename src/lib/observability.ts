import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// Lightweight telemetry for the observability dashboard - NOT the source of
// truth for anything the app itself reads (Player/Bidder/Auction rows stay
// that). Every write here must be safe to lose: a logging failure must never
// break the real feature it's observing.
//
// Two call shapes, matched to how latency-sensitive the caller is:
//  - logEventAsync: fire-and-forget via Vercel's waitUntil, for the hot path
//    (bid placement, every Pusher trigger during live bidding) - the request
//    doesn't wait on this write.
//  - logEvent: awaited, for low-frequency admin actions (pause/resume/end,
//    mark-sold) where an extra ~20ms is irrelevant and awaiting means a
//    dashboard reader never sees a gap from a write that got dropped.
// Both share the same swallow-all error handling, because a broken metrics
// pipe should never surface as a broken auction.

export type ObservabilityCategory = 'pusher' | 'rate_limit' | 'bid' | 'sync_lag' | 'api_error' | 'pusher_client' | 'canary' | 'alert'

interface ObservabilityEventInput {
  category: ObservabilityCategory
  eventName: string
  auctionId?: string | null
  success?: boolean
  latencyMs?: number
  message?: string
  metadata?: Record<string, unknown>
}

async function writeEvent(input: ObservabilityEventInput): Promise<void> {
  try {
    await prisma.observabilityEvent.create({
      data: {
        category: input.category,
        eventName: input.eventName,
        auctionId: input.auctionId ?? null,
        success: input.success ?? true,
        latencyMs: input.latencyMs,
        message: input.message,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    })
  } catch (error) {
    // Never let telemetry failure bubble up - log to console (still captured
    // by Vercel's function logs / Sentry breadcrumbs) and move on.
    console.error('[observability] failed to record event', input.category, input.eventName, error)
  }
}

// Prisma's known-request errors carry a documented .code (P1001 = can't
// reach the database, P2024 = connection pool timeout, P2002 = unique
// constraint violation, etc. - see prisma.io/docs/orm/reference/error-reference)
// and a .meta object with per-code detail. Capturing .code separately from
// the message lets the dashboard's diagnosis logic match on a stable,
// documented value instead of parsing free-form error text.
export function describeError(error: unknown): { message: string; metadata?: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error)
  const e = error as { code?: string; meta?: unknown; name?: string }
  if (e?.code) {
    return { message, metadata: { errorCode: e.code, errorName: e.name, errorMeta: e.meta } }
  }
  return { message }
}

export function logEventAsync(input: ObservabilityEventInput): void {
  waitUntil(writeEvent(input))
}

export function logEvent(input: ObservabilityEventInput): Promise<void> {
  return writeEvent(input)
}

// Wraps any async operation, timing it and recording success/failure -
// the shape every one of the Pusher trigger call sites needs.
export async function withTiming<T>(
  input: Omit<ObservabilityEventInput, 'success' | 'latencyMs' | 'message'>,
  fn: () => Promise<T>,
  options: { async?: boolean } = {}
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    const record = { ...input, success: true, latencyMs: Date.now() - start }
    if (options.async) logEventAsync(record)
    else await logEvent(record)
    return result
  } catch (error) {
    const record = {
      ...input,
      success: false,
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    }
    if (options.async) logEventAsync(record)
    else await logEvent(record)
    throw error
  }
}
