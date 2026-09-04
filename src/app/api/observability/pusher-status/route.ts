import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { pusher } from '@/lib/pusher'
import { prisma } from '@/lib/prisma'
import { getPusherPlan } from '@/lib/pusher-plans'

// Live headroom check, not historical - this is the "how close are we to the
// ceiling right now" panel the incident needed. Pusher's channels REST API
// (available on every plan, no special tier) gives live occupied-channel and
// subscriber counts; there is no documented endpoint for "% of daily message
// quota used" or "which plan is this app on" on the same app credentials -
// both only live in Pusher's own dashboard, so this panel can't ask Pusher
// directly. Instead it's told: getPusherPlan() reads PUSHER_PLAN (set to
// sandbox/startup/pro/business/premium/growth/plus/growth_plus) and looks up
// that tier's real published connection/message limits.
//
// The message-count estimate below is still an ESTIMATE, not Pusher's exact
// billed count: it multiplies each auction's actual trigger count today by
// that auction's CURRENT live subscriber count, as a stand-in for "how many
// people were listening when those triggers fired" - accurate while an
// auction is still live and its audience hasn't changed much, an
// undercount for auctions that already ended (no live audience left to
// multiply by, so those triggers can't be estimated and are reported
// separately instead of silently dropped).

interface PusherChannelInfo {
  subscription_count?: number
  occupied?: boolean
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const response = await pusher.get({
      path: '/channels',
      params: { filter_by_prefix: 'auction-', info: 'subscription_count' },
    })

    if (response.status !== 200) {
      const detail = await response.text().catch(() => '')
      return NextResponse.json({ error: `Pusher API returned ${response.status}`, detail }, { status: 502 })
    }

    const body = (await response.json()) as { channels?: Record<string, PusherChannelInfo> }
    const channels = body.channels ?? {}
    const auctionIds = Object.keys(channels).map(name => name.replace(/^auction-/, ''))

    const auctions = auctionIds.length > 0
      ? await prisma.auction.findMany({
          where: { id: { in: auctionIds } },
          select: { id: true, name: true, status: true },
        })
      : []
    const auctionById = new Map(auctions.map(a => [a.id, a]))

    const items = Object.entries(channels)
      .map(([channelName, info]) => {
        const id = channelName.replace(/^auction-/, '')
        const auction = auctionById.get(id)
        return {
          channel: channelName,
          auctionId: id,
          auctionName: auction?.name ?? null,
          auctionStatus: auction?.status ?? null,
          subscriptionCount: info.subscription_count ?? 0,
        }
      })
      .sort((a, b) => b.subscriptionCount - a.subscriptionCount)

    const totalSubscribers = items.reduce((sum, i) => sum + i.subscriptionCount, 0)
    const plan = getPusherPlan()

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    // Per-auction trigger counts today - the input to the message estimate
    // below. $queryRaw, not Prisma's groupBy: this project's Prisma Client
    // is wrapped in the Accelerate extension, which breaks groupBy's
    // generic type inference (every field resolves to `{}`).
    const triggersByAuction = await prisma.$queryRaw<Array<{ auctionId: string | null; count: bigint }>>(Prisma.sql`
      SELECT "auctionId", COUNT(*)::int as count
      FROM observability_events
      WHERE category = 'pusher' AND success = true AND "createdAt" >= ${since}
      GROUP BY "auctionId"
    `)

    const liveSubscribersByAuction = new Map(items.map(i => [i.auctionId, i.subscriptionCount]))
    let estimatedMessagesToday = 0
    let unestimatedTriggersToday = 0
    let broadcastsToday = 0
    for (const row of triggersByAuction) {
      const triggerCount = Number(row.count)
      broadcastsToday += triggerCount
      const liveSubs = row.auctionId ? liveSubscribersByAuction.get(row.auctionId) : undefined
      if (liveSubs !== undefined) {
        estimatedMessagesToday += triggerCount * liveSubs
      } else {
        // This auction has no live channel right now (ended, or everyone
        // left) - no current subscriber count to multiply its triggers by,
        // so they're reported separately rather than silently treated as 0.
        unestimatedTriggersToday += triggerCount
      }
    }

    return NextResponse.json({
      totalChannels: items.length,
      totalSubscribers,
      channels: items,
      plan: { key: plan.key, label: plan.label },
      connectionCeiling: {
        maxConnections: plan.maxConnections,
        usedPercent: plan.maxConnections > 0 ? Math.round((totalSubscribers / plan.maxConnections) * 100) : null,
      },
      broadcastsToday,
      messageEstimate: {
        estimatedMessagesToday,
        unestimatedTriggersToday,
        messagesPerDayLimit: plan.messagesPerDay,
        usedPercent: plan.messagesPerDay > 0 ? Math.round((estimatedMessagesToday / plan.messagesPerDay) * 100) : null,
      },
    })
  } catch (error) {
    console.error('Error fetching Pusher status:', error)
    return NextResponse.json({ error: 'Failed to reach Pusher API' }, { status: 502 })
  }
}
