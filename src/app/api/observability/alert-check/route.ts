import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logEvent } from '@/lib/observability'

// The one gap that actually mattered from the original incident: everything
// else in this system is a dashboard someone has to remember to open. This
// is the piece that taps a human on the shoulder instead. Meant to be hit
// every few minutes by a scheduled job (see .github/workflows/observability-cron.yml)
// - it evaluates recent data against fixed thresholds and posts to a webhook
// (Slack/Discord incoming webhook URL, or any endpoint that accepts a JSON
// body with a "text" field) only when something is actually wrong.
//
// Deliberately NOT a Vercel Cron Job - see cleanup/route.ts for why.

const WINDOW_MS = 15 * 60 * 1000 // recent window: catch an active incident fast, not a diluted daily average
const COOLDOWN_MS = 20 * 60 * 1000 // don't re-fire the same alert every 5 minutes while a problem persists

const THRESHOLDS = {
  minSampleSize: 5, // don't judge success rate off 1-2 requests
  minSuccessRate: 0.9,
  maxAvgSyncLagMs: 3000,
  minSyncLagSamples: 3,
  maxConnectionErrors: 5,
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.OBSERVABILITY_CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

async function alreadyAlertedRecently(eventName: string): Promise<boolean> {
  const since = new Date(Date.now() - COOLDOWN_MS)
  const recent = await prisma.observabilityEvent.findFirst({
    where: { category: 'alert', eventName, createdAt: { gte: since } },
  })
  return !!recent
}

async function sendAlert(eventName: string, text: string): Promise<void> {
  if (await alreadyAlertedRecently(eventName)) return

  const webhookUrl = process.env.ALERT_WEBHOOK_URL
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Both keys so the same webhook works whether it's Slack (reads "text")
        // or Discord (reads "content") - each ignores the key it doesn't use.
        body: JSON.stringify({ text, content: text }),
      })
    } catch (error) {
      console.error('[observability] failed to send alert webhook', eventName, error)
    }
  } else {
    console.warn('[observability] ALERT_WEBHOOK_URL not set - alert not delivered:', text)
  }

  await logEvent({ category: 'alert', eventName, success: false, message: text })
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date(Date.now() - WINDOW_MS)
  const fired: string[] = []

  try {
    const [totalRows, syncLagRows, connectionErrorRows, latestCanary] = await Promise.all([
      prisma.$queryRaw<Array<{ total: bigint; failures: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE success = false)::int as failures
        FROM observability_events
        WHERE "createdAt" >= ${since}
      `),
      prisma.$queryRaw<Array<{ avgMs: number | null; sampleCount: bigint }>>(Prisma.sql`
        SELECT AVG("latencyMs")::int as "avgMs", COUNT(*)::int as "sampleCount"
        FROM observability_events
        WHERE category = 'sync_lag' AND "createdAt" >= ${since}
      `),
      prisma.observabilityEvent.count({
        where: { category: 'pusher_client', eventName: 'connection_error', createdAt: { gte: since } },
      }),
      prisma.observabilityEvent.findFirst({
        where: { category: 'canary', eventName: 'heartbeat' },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const total = Number(totalRows[0]?.total ?? 0)
    const failures = Number(totalRows[0]?.failures ?? 0)
    const successRate = total > 0 ? (total - failures) / total : 1

    if (total >= THRESHOLDS.minSampleSize && successRate < THRESHOLDS.minSuccessRate) {
      const pct = Math.round(successRate * 100)
      await sendAlert('low_success_rate', `🔴 Squady observability: success rate dropped to ${pct}% over the last 15 minutes (${failures}/${total} events failed).`)
      fired.push('low_success_rate')
    }

    const avgLag = syncLagRows[0]?.avgMs ?? null
    const lagSamples = Number(syncLagRows[0]?.sampleCount ?? 0)
    if (lagSamples >= THRESHOLDS.minSyncLagSamples && avgLag !== null && avgLag > THRESHOLDS.maxAvgSyncLagMs) {
      await sendAlert('high_sync_lag', `🟠 Squady observability: average bid sync lag is ${avgLag}ms over the last 15 minutes (threshold ${THRESHOLDS.maxAvgSyncLagMs}ms) - bidders may be seeing stale state.`)
      fired.push('high_sync_lag')
    }

    if (connectionErrorRows > THRESHOLDS.maxConnectionErrors) {
      await sendAlert('connection_errors', `🟠 Squady observability: ${connectionErrorRows} client connection errors in the last 15 minutes - Pusher subscriptions may be failing.`)
      fired.push('connection_errors')
    }

    if (latestCanary && !latestCanary.success) {
      const ageMs = Date.now() - latestCanary.createdAt.getTime()
      // Only alert on a fresh failed canary - an old one means the canary job
      // itself stopped running, not that the platform is down right now.
      if (ageMs < WINDOW_MS) {
        await sendAlert('canary_failed', `🔴 Squady observability: the synthetic heartbeat check just failed (${latestCanary.message ?? 'no detail'}) - Pusher or the database may be unreachable.`)
        fired.push('canary_failed')
      }
    }

    return NextResponse.json({ checked: true, fired, since: since.toISOString() })
  } catch (error) {
    console.error('Error running observability alert check:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
