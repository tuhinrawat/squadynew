import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { compressImageToDataUrl } from '@/lib/image-compress'

// A well-compressed 400px logo lands well under this - only worth
// re-processing (and re-writing to the database) logos actually bloated by
// the uncompressed-upload bug this endpoint exists to clean up after.
const RECOMPRESS_THRESHOLD_BYTES = 30 * 1024

function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
  if (!match) return null
  return Buffer.from(match[1], 'base64')
}

/**
 * POST /api/debug/compress-bidder-logos
 * One-time cleanup for bidder.logoUrl values stored before uploads were
 * compressed server-side - these were saved as raw, full-size base64 blobs
 * (sometimes multiple MB each) and shipped in full on every page load/poll.
 * Re-compresses any oversized logo in place; leaves already-small ones alone.
 *
 * body: { auctionId?: string } - scopes to one auction; omit to process
 * every bidder across every auction (use deliberately, not by default).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const auctionId: string | undefined = body.auctionId

    const bidders = await prisma.bidder.findMany({
      where: auctionId ? { auctionId } : undefined,
      select: { id: true, teamName: true, logoUrl: true },
    })

    const results: Array<{ bidderId: string; teamName: string | null; status: string; beforeBytes?: number; afterBytes?: number; message?: string }> = []
    let recompressed = 0
    let skipped = 0
    let errors = 0

    for (const bidder of bidders) {
      if (!bidder.logoUrl || !bidder.logoUrl.startsWith('data:')) {
        skipped++
        continue
      }

      const beforeBytes = Buffer.byteLength(bidder.logoUrl, 'utf8')
      if (beforeBytes < RECOMPRESS_THRESHOLD_BYTES) {
        skipped++
        continue
      }

      try {
        const buffer = decodeDataUrl(bidder.logoUrl)
        if (!buffer) {
          errors++
          results.push({ bidderId: bidder.id, teamName: bidder.teamName, status: 'error', message: 'Could not decode existing logoUrl as a data URL' })
          continue
        }

        const compressed = await compressImageToDataUrl(buffer)
        const afterBytes = Buffer.byteLength(compressed, 'utf8')

        await prisma.bidder.update({ where: { id: bidder.id }, data: { logoUrl: compressed } })

        recompressed++
        results.push({ bidderId: bidder.id, teamName: bidder.teamName, status: 'recompressed', beforeBytes, afterBytes })
      } catch (err) {
        errors++
        results.push({ bidderId: bidder.id, teamName: bidder.teamName, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
      }
    }

    return NextResponse.json({
      success: true,
      summary: { totalBidders: bidders.length, recompressed, skipped, errors },
      results,
    })
  } catch (error) {
    console.error('Error compressing bidder logos:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
