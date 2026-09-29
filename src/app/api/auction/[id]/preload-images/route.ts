import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { extractProxyImageUrl } from '@/lib/player-photo'
import { logEventAsync, describeError } from '@/lib/observability'

// A pool of a few hundred players, each needing its own outbound fetch to
// Google Drive, can run well past a default function timeout.
export const maxDuration = 60

// Presenter mode always requests player photos at this width (see
// getProfilePhotoUrl in public-auction-view.tsx) - warming any other width
// wouldn't hit the cache key presenter's own requests actually use.
const PRESENTER_WIDTH = 800
// Bounded concurrency - firing every request at once would both hammer
// Google Drive's unofficial thumbnail endpoint (the exact fragility this is
// meant to protect against) and risk exhausting this function's own runtime.
const CONCURRENCY = 8

// Triggered from the dashboard's auction actions ("Preload Images", next to
// Presenter Link / Public Link / Duplicate) before a live event. Fetches
// every eligible player's presenter-width photo through this deployment's
// own /api/proxy-image, so Vercel's edge cache is already warm by the time
// the actual presenter screen asks for the same URLs live - see that
// route's Cache-Control header, which is what makes this warming stick.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, createdById: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: "Only this auction's admin can preload images" }, { status: 403 })
    }

    // Every player still eligible to appear on stage. RETIRED players never
    // enter the pool; a SOLD player is included anyway since Undo Sale can
    // put them back up, and there's no reason to assume that won't happen.
    const players = await prisma.player.findMany({
      where: { auctionId: params.id, status: { not: 'RETIRED' } },
      select: { id: true, data: true },
    })

    const targets = players
      .map(p => ({ id: p.id, url: extractProxyImageUrl(p.data as Record<string, unknown>, PRESENTER_WIDTH) }))
      .filter((p): p is { id: string; url: string } => !!p.url && p.url.startsWith('/api/proxy-image'))

    const origin = request.nextUrl.origin
    let succeeded = 0
    const failedIds: string[] = []

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(({ url }) => fetch(`${origin}${url}`))
      )
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value.ok) {
          succeeded++
        } else {
          failedIds.push(batch[idx].id)
        }
      })
    }

    return NextResponse.json({
      success: true,
      totalWithPhoto: targets.length,
      withoutPhoto: players.length - targets.length,
      succeeded,
      failed: failedIds.length,
    })
  } catch (error) {
    console.error('Error preloading player images:', error)
    logEventAsync({ category: 'api_error', eventName: 'preload_images', auctionId: params.id, success: false, ...describeError(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
