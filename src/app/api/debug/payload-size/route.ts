import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { parseBidHistory, filterBidHistoryForCurrentPlayer } from '@/lib/auction-view-data'
import { extractPlayerName } from '@/lib/player-name'
import { extractProfilePhotoValue, extractProxyImageUrl } from '@/lib/player-photo'
import { isLiveStatus } from '@/lib/auction-status'

// One-off diagnostic, not part of the app's real request path: measures
// ACTUAL byte sizes against a REAL auction's real data, for a direct
// before/after comparison against the payload-size fixes made across this
// project - the trimmed snapshot response, and the per-context image
// widths. Read-only; makes no writes. GET /api/debug/payload-size?auctionId=...
// (or ?name=... to search by name, same convention as the other debug
// routes in this folder).
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const auctionId = searchParams.get('auctionId')
    const name = searchParams.get('name')

    const auction = auctionId
      ? await prisma.auction.findUnique({ where: { id: auctionId } })
      : await prisma.auction.findFirst({
          where: name ? { name: { contains: name, mode: 'insensitive' } } : undefined,
          orderBy: { createdAt: 'desc' },
        })

    if (!auction) {
      return NextResponse.json({
        error: 'Auction not found - pass ?auctionId=<id> or ?name=<search term>',
        availableAuctions: await prisma.auction.findMany({
          select: { id: true, name: true, _count: { select: { players: true, bidders: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      }, { status: 404 })
    }

    // Refuses to run against a LIVE/MOCK_RUN auction - this diagnostic fires
    // up to 18 concurrent requests to Drive's thumbnail endpoint (6 widths x
    // 3 Accept-header variants) plus several database reads, both drawn from
    // the exact same shared, rate-limited resources (Drive, Prisma
    // operations) the real presenter screen depends on mid-auction. Running
    // this during live bidding would compete with the real presenter for
    // Drive's bandwidth right where its latency tail already runs longest,
    // and spend real operations budget on a test instead of the auction.
    // Safe once the auction isn't actively running (DRAFT/PAUSED/COMPLETED).
    if (isLiveStatus(auction.status)) {
      return NextResponse.json({
        error: `This auction is currently ${auction.status} - this diagnostic is blocked while an auction is live to avoid competing with the real presenter screen for Google Drive bandwidth and database operations. Run it before going live, during a pause, or after the auction ends.`,
      }, { status: 409 })
    }

    // ---- 1. Current (post-optimization) snapshot payload - exact same
    // queries and shape as /api/auction/[id]/snapshot/route.ts ----
    const [trimmedPlayers, trimmedBidders, currentPlayerFull, recentSoldPlayers] = await Promise.all([
      prisma.player.findMany({ where: { auctionId: auction.id }, select: { id: true, status: true, isIcon: true } }),
      prisma.bidder.findMany({ where: { auctionId: auction.id }, select: { id: true, remainingPurse: true } }),
      auction.currentPlayerId
        ? prisma.player.findUnique({
            where: { id: auction.currentPlayerId },
            select: {
              id: true, auctionId: true, data: true, status: true, isIcon: true, soldTo: true, soldPrice: true,
              lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true,
              serialNumber: true,
            },
          })
        : Promise.resolve(null),
      prisma.player.findMany({
        where: { auctionId: auction.id, status: 'SOLD', soldAt: { not: null } },
        orderBy: { soldAt: 'desc' },
        take: 10,
        select: { id: true, data: true, soldTo: true, soldPrice: true, soldAt: true },
      }),
    ])

    const currentPlayer = currentPlayerFull && currentPlayerFull.status !== 'SOLD' ? currentPlayerFull : null
    const bidHistory = filterBidHistoryForCurrentPlayer(parseBidHistory(auction.bidHistory), currentPlayer?.id)
    const buyerIds = [...new Set(recentSoldPlayers.map(p => p.soldTo).filter((id): id is string => !!id))]
    const buyers = buyerIds.length > 0
      ? await prisma.bidder.findMany({ where: { id: { in: buyerIds } }, select: { id: true, teamName: true, username: true } })
      : []
    const recentSales = recentSoldPlayers.map(p => {
      const buyer = buyers.find(b => b.id === p.soldTo)
      return {
        id: p.id,
        name: extractPlayerName(p.data as Record<string, unknown> | null | undefined) || 'Unknown Player',
        price: p.soldPrice ?? 0,
        buyer: buyer?.teamName || buyer?.username || 'Unknown',
        soldAt: p.soldAt,
      }
    })
    const currentSnapshotBody = {
      auctionId: auction.id, auctionStatus: auction.status, isOfflineMode: auction.isOfflineMode,
      currentPlayer, players: trimmedPlayers, bidders: trimmedBidders, bidHistory,
      poolExhausted: false, recentSales,
    }
    const currentSnapshotBytes = Buffer.byteLength(JSON.stringify(currentSnapshotBody), 'utf8')

    // ---- 2. Pre-optimization equivalent, on this SAME real auction - full
    // player rows (every uploaded field, not just id/status/isIcon) and full
    // bidder rows (including logoUrl), which is what every 6-second poll
    // used to send for every player and every bidder, not just the one on
    // stage. ----
    const [fullPlayers, fullBidders] = await Promise.all([
      prisma.player.findMany({ where: { auctionId: auction.id } }),
      prisma.bidder.findMany({ where: { auctionId: auction.id } }),
    ])
    const preOptimizationBody = {
      auctionId: auction.id, auctionStatus: auction.status,
      currentPlayer: currentPlayerFull, players: fullPlayers, bidders: fullBidders, bidHistory,
      poolExhausted: false, recentSales,
    }
    const preOptimizationBytes = Buffer.byteLength(JSON.stringify(preOptimizationBody), 'utf8')

    // ---- 3. Initial page load payload - same include shape as the SSR
    // page at src/app/auction/[id]/page.tsx ----
    const ssrPageData = await prisma.auction.findUnique({
      where: { id: auction.id },
      include: { players: true, bidders: { include: { user: { select: { id: true, name: true, email: true } } } } },
    })
    const ssrPageBytes = Buffer.byteLength(JSON.stringify(ssrPageData), 'utf8')

    // ---- 4. Real image bytes, fetched through this deployment's own
    // /api/proxy-image - actual downloaded size at each width it supports,
    // not an estimate. Picks one real player photo from this auction (the
    // current player's if set, else the first player that has one). ----
    const candidatePlayers = currentPlayerFull ? [currentPlayerFull, ...fullPlayers] : fullPlayers
    const sampleWithPhoto = candidatePlayers.find(p => extractProfilePhotoValue(p.data as Record<string, unknown> | null | undefined))
    const imageSizesByWidth: Array<{
      width: number
      originalBytes: number | null
      webpBytes: number | null
      avifBytes: number | null
      webpSavingsPercent: number | null
      avifSavingsPercent: number | null
      error?: string
    }> = []
    if (sampleWithPhoto) {
      const origin = request.nextUrl.origin
      const widths = [200, 300, 400, 600, 800, 1000]
      // Same self-fetch-through-the-real-route approach as before, now once
      // per Accept header so the re-encoding actually being served to real
      // browsers is what gets measured, not a guess.
      const fetchWithAccept = async (relativeUrl: string, accept: string | null) => {
        const res = await fetch(`${origin}${relativeUrl}`, accept ? { headers: { Accept: accept } } : undefined)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = await res.arrayBuffer()
        return buf.byteLength
      }
      for (const w of widths) {
        const relativeUrl = extractProxyImageUrl(sampleWithPhoto.data as Record<string, unknown> | null | undefined, w)
        if (!relativeUrl || !relativeUrl.startsWith('/api/proxy-image')) continue
        try {
          const [originalBytes, webpBytes, avifBytes] = await Promise.all([
            fetchWithAccept(relativeUrl, null),
            fetchWithAccept(relativeUrl, 'image/webp,*/*'),
            fetchWithAccept(relativeUrl, 'image/avif,image/webp,*/*'),
          ])
          imageSizesByWidth.push({
            width: w,
            originalBytes,
            webpBytes,
            avifBytes,
            webpSavingsPercent: originalBytes > 0 ? Math.round((1 - webpBytes / originalBytes) * 10000) / 100 : null,
            avifSavingsPercent: originalBytes > 0 ? Math.round((1 - avifBytes / originalBytes) * 10000) / 100 : null,
          })
        } catch (err) {
          imageSizesByWidth.push({
            width: w, originalBytes: null, webpBytes: null, avifBytes: null,
            webpSavingsPercent: null, avifSavingsPercent: null,
            error: err instanceof Error ? err.message : 'fetch failed',
          })
        }
      }
    }

    // ---- 5. Request-volume extrapolation using THIS auction's real
    // player/bidder counts, for whatever viewer count / duration you pass -
    // defaults are a reasonable illustrative scenario, not a claim about
    // your actual event. ----
    const viewers = Number(searchParams.get('viewers')) || 100
    const minutes = Number(searchParams.get('minutes')) || 120
    const seconds = minutes * 60
    const oldPollsPerViewer = Math.floor(seconds / 6)
    const oldTotalRequests = viewers * oldPollsPerViewer
    const oldTotalBytes = oldTotalRequests * preOptimizationBytes
    const newTotalRequests = viewers // one load each; manual taps not counted - can't predict human behavior
    const newTotalBytes = newTotalRequests * currentSnapshotBytes

    const round = (n: number) => Math.round(n * 100) / 100

    return NextResponse.json({
      auction: {
        id: auction.id, name: auction.name,
        playerCount: fullPlayers.length, bidderCount: fullBidders.length,
      },
      snapshotPayload: {
        note: 'Measured from this auction\'s real data, not estimated. "preOptimization" rebuilds what the same endpoint used to send before payload trimming, on the exact same rows.',
        currentBytes: currentSnapshotBytes,
        currentKB: round(currentSnapshotBytes / 1024),
        preOptimizationBytes,
        preOptimizationKB: round(preOptimizationBytes / 1024),
        reductionPercent: preOptimizationBytes > 0 ? round((1 - currentSnapshotBytes / preOptimizationBytes) * 100) : null,
      },
      initialPageLoadPayload: {
        note: 'The one-time SSR data payload on first page load (not counting JS bundle, images, or CSS) - unaffected by the polling fix, since this always fetches full player/bidder data once.',
        bytes: ssrPageBytes,
        KB: round(ssrPageBytes / 1024),
      },
      realImageSizes: {
        note: sampleWithPhoto
          ? 'Real bytes downloaded through this deployment\'s own /api/proxy-image for one real player photo from this auction, at every width the app actually requests - "original" (no Accept override, i.e. no format request), "webp" and "avif" each self-fetch with the Accept header a real browser advertising that format would send, so these are the actual re-encoded bytes being served, not estimates.'
          : 'No player in this auction has a photo field set - nothing to measure.',
        sampleFrom: sampleWithPhoto ? extractPlayerName(sampleWithPhoto.data as Record<string, unknown> | null | undefined) : null,
        byWidth: imageSizesByWidth,
      },
      requestVolumeExtrapolation: {
        note: 'Illustrative only - pass ?viewers=N&minutes=M for your own scenario. "new" assumes each viewer loads once and never taps Refresh, since manual behavior can\'t be predicted; real usage will be somewhat higher than this floor, not lower.',
        assumptions: { viewers, minutes },
        before6sPolling: { totalRequests: oldTotalRequests, totalBytes: oldTotalBytes, totalMB: round(oldTotalBytes / 1024 / 1024) },
        afterManualRefresh: { totalRequests: newTotalRequests, totalBytes: newTotalBytes, totalMB: round(newTotalBytes / 1024 / 1024) },
      },
    })
  } catch (error) {
    console.error('Error measuring payload size:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
