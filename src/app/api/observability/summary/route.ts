import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { diagnose } from '@/lib/error-diagnosis'

// Cross-auction infra telemetry (Pusher health, rate-limit rejections) -
// SUPER_ADMIN only, same reasoning as /dashboard/settings: this isn't scoped
// to "auctions I created," it's platform-wide operational data.
//
// Aggregation goes through $queryRaw rather than Prisma's groupBy: this
// project's Prisma Client is wrapped in the Accelerate extension
// ($extends(withAccelerate())), which breaks groupBy's generic type
// inference (every field resolves to `{}` - reproduced standalone, no
// existing groupBy call anywhere else in the codebase to compare against).
// Raw SQL sidesteps it and is a single indexed query anyway.

const RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '24h'
    const auctionId = searchParams.get('auctionId') || undefined
    const rangeMs = RANGE_MS[range] ?? RANGE_MS['24h']
    const since = new Date(Date.now() - rangeMs)

    const auctionFilter = auctionId ? Prisma.sql`AND "auctionId" = ${auctionId}` : Prisma.empty

    const [totalRows, breakdown, recentFailures, slowEvents, auctions, bidsPerMinute, syncLagRows, connectionHealthRows, latestCanary, recentAlerts, snapshotHealthRows] = await Promise.all([
      prisma.$queryRaw<Array<{ total: bigint; failures: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE success = false)::int as failures
        FROM observability_events
        WHERE "createdAt" >= ${since} ${auctionFilter}
      `),
      prisma.$queryRaw<Array<{ category: string; eventName: string; success: boolean; count: bigint; avgLatencyMs: number | null }>>(Prisma.sql`
        SELECT category, "eventName", success, COUNT(*)::int as count, AVG("latencyMs")::int as "avgLatencyMs"
        FROM observability_events
        WHERE "createdAt" >= ${since} ${auctionFilter}
        GROUP BY category, "eventName", success
        ORDER BY count DESC
      `),
      prisma.observabilityEvent.findMany({
        where: {
          createdAt: { gte: since },
          success: false,
          ...(auctionId ? { auctionId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, category: true, eventName: true, auctionId: true, message: true, latencyMs: true, createdAt: true, metadata: true },
      }),
      // Successful but slow (or, for snapshot polls, oversized) - the
      // "clogging" signal from the original incident: not a failure yet, but
      // heading there. Thresholds match error-diagnosis.ts's
      // SLOW_THRESHOLD_MS / SNAPSHOT_SIZE_WARN_BYTES.
      prisma.$queryRaw<Array<{ id: string; category: string; eventName: string; auctionId: string | null; message: string | null; latencyMs: number | null; createdAt: Date; metadata: unknown }>>(Prisma.sql`
        SELECT id, category, "eventName", "auctionId", message, "latencyMs", "createdAt", metadata
        FROM observability_events
        WHERE success = true
          AND (
            (category = 'pusher' AND "latencyMs" > 3000)
            OR (category = 'sync_lag' AND "latencyMs" > 5000)
            OR (category = 'snapshot' AND "latencyMs" > 2000)
            OR (category = 'snapshot' AND (metadata->>'responseBytes')::int > 153600)
          )
          AND "createdAt" >= ${since} ${auctionFilter}
        ORDER BY "latencyMs" DESC
        LIMIT 25
      `),
      prisma.auction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, name: true },
      }),
      prisma.$queryRaw<Array<{ minute: Date; count: bigint }>>(Prisma.sql`
        SELECT date_trunc('minute', "createdAt") as minute, COUNT(*)::int as count
        FROM observability_events
        WHERE category = 'pusher' AND "eventName" = 'new-bid' AND success = true
          AND "createdAt" >= ${since} ${auctionFilter}
        GROUP BY minute
        ORDER BY minute ASC
      `),
      // Client-reported: real time from server-stamped bid to this browser
      // receiving it - the literal measure of "clogged."
      prisma.$queryRaw<Array<{ avgMs: number | null; maxMs: number | null; sampleCount: bigint }>>(Prisma.sql`
        SELECT AVG("latencyMs")::int as "avgMs", MAX("latencyMs")::int as "maxMs", COUNT(*)::int as "sampleCount"
        FROM observability_events
        WHERE category = 'sync_lag' AND "createdAt" >= ${since} ${auctionFilter}
      `),
      // Client-reported: subscription health and how often the rebind
      // workaround (pusher-client.ts's periodic recheck) actually fired.
      prisma.$queryRaw<Array<{ eventName: string; count: bigint }>>(Prisma.sql`
        SELECT "eventName", COUNT(*)::int as count
        FROM observability_events
        WHERE category = 'pusher_client' AND "createdAt" >= ${since} ${auctionFilter}
        GROUP BY "eventName"
      `),
      // Synthetic heartbeat, independent of live traffic - see canary/route.ts.
      prisma.observabilityEvent.findFirst({
        where: { category: 'canary', eventName: 'heartbeat' },
        orderBy: { createdAt: 'desc' },
        select: { success: true, latencyMs: true, createdAt: true, message: true },
      }),
      // What the alert-check job actually fired recently, so an admin can see
      // whether alerting is wired up and working, not just configured.
      prisma.observabilityEvent.findMany({
        where: { category: 'alert' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { eventName: true, message: true, createdAt: true },
      }),
      // The one number that ties viewer count to bandwidth cost: what every
      // public viewer's browser actually downloads on each 6-second poll.
      // Flat and small (10-15KB) is healthy; growing or spiking here is the
      // earliest sign of the exact bug this instrumentation was added for.
      prisma.$queryRaw<Array<{ avgBytes: number | null; maxBytes: number | null; avgLatencyMs: number | null; maxLatencyMs: number | null; sampleCount: bigint; failureCount: bigint }>>(Prisma.sql`
        SELECT
          AVG((metadata->>'responseBytes')::int)::int as "avgBytes",
          MAX((metadata->>'responseBytes')::int)::int as "maxBytes",
          AVG("latencyMs") FILTER (WHERE success = true)::int as "avgLatencyMs",
          MAX("latencyMs") FILTER (WHERE success = true)::int as "maxLatencyMs",
          COUNT(*) FILTER (WHERE success = true)::int as "sampleCount",
          COUNT(*) FILTER (WHERE success = false)::int as "failureCount"
        FROM observability_events
        WHERE category = 'snapshot' AND "createdAt" >= ${since} ${auctionFilter}
      `),
    ])

    const totalCount = Number(totalRows[0]?.total ?? 0)
    const failureCount = Number(totalRows[0]?.failures ?? 0)

    const connectionHealth = { connected: 0, connection_error: 0, rebind: 0 }
    for (const row of connectionHealthRows) {
      if (row.eventName in connectionHealth) {
        connectionHealth[row.eventName as keyof typeof connectionHealth] = Number(row.count)
      }
    }

    return NextResponse.json({
      range,
      since: since.toISOString(),
      totalCount,
      failureCount,
      successRate: totalCount > 0 ? (totalCount - failureCount) / totalCount : 1,
      breakdown: breakdown.map(row => ({
        category: row.category,
        eventName: row.eventName,
        success: row.success,
        count: Number(row.count),
        avgLatencyMs: row.avgLatencyMs,
      })),
      recentFailures: recentFailures.map(f => ({
        ...f,
        diagnosis: diagnose({ category: f.category, eventName: f.eventName, success: false, message: f.message, metadata: f.metadata as Record<string, unknown> | null, latencyMs: f.latencyMs }),
      })),
      slowEvents: slowEvents.map(s => ({
        ...s,
        diagnosis: diagnose({ category: s.category, eventName: s.eventName, success: true, message: s.message, metadata: s.metadata as Record<string, unknown> | null, latencyMs: s.latencyMs }),
      })),
      bidsPerMinute: bidsPerMinute.map(row => ({ minute: row.minute, count: Number(row.count) })),
      auctions,
      syncLag: {
        avgMs: syncLagRows[0]?.avgMs ?? null,
        maxMs: syncLagRows[0]?.maxMs ?? null,
        sampleCount: Number(syncLagRows[0]?.sampleCount ?? 0),
      },
      connectionHealth,
      latestCanary,
      alertingConfigured: !!process.env.ALERT_WEBHOOK_URL,
      recentAlerts,
      snapshotHealth: {
        avgBytes: snapshotHealthRows[0]?.avgBytes ?? null,
        maxBytes: snapshotHealthRows[0]?.maxBytes ?? null,
        avgLatencyMs: snapshotHealthRows[0]?.avgLatencyMs ?? null,
        maxLatencyMs: snapshotHealthRows[0]?.maxLatencyMs ?? null,
        sampleCount: Number(snapshotHealthRows[0]?.sampleCount ?? 0),
        failureCount: Number(snapshotHealthRows[0]?.failureCount ?? 0),
      },
    })
  } catch (error) {
    console.error('Error building observability summary:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
