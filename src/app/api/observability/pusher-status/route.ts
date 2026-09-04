import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { pusher } from '@/lib/pusher'
import { prisma } from '@/lib/prisma'

// Live headroom check, not historical - this is the "how close are we to the
// ceiling right now" panel the incident needed. Pusher's channels REST API
// (available on every plan, no special tier) gives live occupied-channel and
// subscriber counts; there is no documented endpoint for "% of daily message
// quota used" on the same app credentials - that number only lives in
// Pusher's own dashboard, so this panel cannot show it authoritatively.
//
// Two honest approximations instead of a fake precise number:
//  - maxConnections is a manually-configured ceiling (env var, defaulting to
//    Pusher's Sandbox/free-tier limit) compared against the live subscriber
//    count above - tells you how close you are to a CONNECTION limit.
//  - broadcastsToday counts this app's own logged 'pusher' trigger calls in
//    the last 24h - a proxy for MESSAGE volume, not Pusher's real message
//    count (a single trigger to N subscribers counts as N messages on
//    Pusher's side, which this number does not multiply out). Labeled as
//    such in the dashboard - never presented as the real quota number.

const DEFAULT_MAX_CONNECTIONS = 100 // Pusher Channels Sandbox (free) plan limit

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
    const maxConnections = Number(process.env.PUSHER_MAX_CONNECTIONS) || DEFAULT_MAX_CONNECTIONS

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const broadcastsToday = await prisma.observabilityEvent.count({
      where: { category: 'pusher', success: true, createdAt: { gte: since } },
    })

    return NextResponse.json({
      totalChannels: items.length,
      totalSubscribers,
      channels: items,
      connectionCeiling: {
        maxConnections,
        usedPercent: maxConnections > 0 ? Math.round((totalSubscribers / maxConnections) * 100) : null,
      },
      broadcastsToday,
    })
  } catch (error) {
    console.error('Error fetching Pusher status:', error)
    return NextResponse.json({ error: 'Failed to reach Pusher API' }, { status: 502 })
  }
}
