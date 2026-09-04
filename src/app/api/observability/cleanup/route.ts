import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// The observability_events table is append-only with no other pruning
// mechanism. Left alone, a popular auction (many viewers, each independently
// reporting sync_lag/connection events) would grow this table indefinitely -
// the monitoring system quietly becoming its own storage/performance
// incident. This endpoint deletes anything older than the retention window
// and is meant to be hit on a schedule (see .github/workflows/observability-cron.yml),
// not by a human or the dashboard.
//
// Not a Vercel Cron Job: Vercel's Hobby (free) plan only allows a cron to run
// once per day, which is too coarse for the canary/alert checks that share
// this same secret-header pattern. A GitHub Actions scheduled workflow can
// run as often as needed for free, so all scheduled observability jobs use
// that instead, calling this endpoint with a shared secret.

const RETENTION_DAYS = 30

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.OBSERVABILITY_CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  try {
    const { count } = await prisma.observabilityEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })

    return NextResponse.json({ deleted: count, cutoff: cutoff.toISOString() })
  } catch (error) {
    console.error('Error cleaning up observability events:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
