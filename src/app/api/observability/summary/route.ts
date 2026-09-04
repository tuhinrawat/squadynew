import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

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

    const [totalRows, breakdown, recentFailures, auctions, bidsPerMinute, syncLagRows, connectionHealthRows, latestCanary, recentAlerts] = await Promise.all([
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
      recentFailures,
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
    })
  } catch (error) {
    console.error('Error building observability summary:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
