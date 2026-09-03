import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { Jimp } from 'jimp'

// Builds the canonical "auction results" spreadsheet - the one format both
// this route and the standalone Auction Control Room tool agree on, rather
// than reverse-engineering an old one-off recovery script's shape. Every
// header here matches the Control Room's column auto-detection exactly, so
// a file downloaded here imports there with zero manual remapping.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRICHEROES_KEYS = ['Cricheroes Profile link', ' Cricheroes Profile link', 'cricheroes profile link', 'Cricheroes Profile Link']
const NAME_KEYS = ['name', 'Name', 'player_name']
// Same header variants the app already checks elsewhere (analytics-view.tsx,
// team-squad-poster.tsx) when looking for a player's Drive photo link.
const PHOTO_KEYS = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto', 'Photo', 'Image', 'Drive Link']

// Excel caps a single cell at 32,767 characters. A base64 data URI is ~4/3
// the size of the underlying image bytes, so this is the ceiling on the
// *encoded string*, not the photo itself - leave real margin for the
// "data:image/jpeg;base64," prefix and encoding overhead.
const MAX_CELL_CHARS = 32000

function extractField(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function extractDriveFileId(link: string): string {
  let match = link.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return match[1]
  match = link.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return match[1]
  return ''
}

// Fetches a player's Drive photo, downsizes it hard, and returns it as an
// inline base64 data URI - the one image format Claude Artifacts' sandbox
// can actually render, since it never issues a network request for it (a
// plain Drive link, proven separately, is unconditionally blocked there).
// Every failure mode (no link, private file, deleted file, still too big
// after compression) resolves to a status string instead of throwing, so
// one bad photo never aborts the whole export.
async function embedPhoto(rawLink: string): Promise<{ dataUri: string; status: string }> {
  if (!rawLink) return { dataUri: '', status: 'no link' }
  const fileId = extractDriveFileId(rawLink)
  if (!fileId) return { dataUri: '', status: 'unrecognized link format' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal
    })
    if (!response.ok) return { dataUri: '', status: `fetch failed (${response.status}) - file may not be shared publicly` }

    const buffer = Buffer.from(await response.arrayBuffer())
    const image = await Jimp.read(buffer)

    // Try progressively smaller/harder-compressed passes until the encoded
    // string fits in one Excel cell.
    const attempts: Array<{ w: number; quality: number }> = [
      { w: 240, quality: 60 },
      { w: 160, quality: 45 },
      { w: 100, quality: 35 }
    ]
    for (const attempt of attempts) {
      const clone = image.clone()
      clone.resize({ w: attempt.w })
      const dataUri = await clone.getBase64('image/jpeg', { quality: attempt.quality })
      if (dataUri.length <= MAX_CELL_CHARS) return { dataUri, status: 'embedded' }
    }
    return { dataUri: '', status: 'photo too large even after compression' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return { dataUri: '', status: `fetch error (${message})` }
  } finally {
    clearTimeout(timeout)
  }
}

// Runs async work with bounded concurrency so exporting ~150-200 player
// photos doesn't fire that many simultaneous requests at Google Drive (or
// blow past serverless memory limits decoding that many images at once).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, createdById: true, rules: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can export results' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const includePhotos = searchParams.get('photos') !== '0'

    const [players, bidders] = await Promise.all([
      prisma.player.findMany({
        where: { auctionId: params.id },
        select: { id: true, data: true, status: true, soldTo: true, soldPrice: true, isIcon: true }
      }),
      prisma.bidder.findMany({
        where: { auctionId: params.id },
        select: {
          id: true, teamName: true, username: true, purseAmount: true, remainingPurse: true,
          user: { select: { name: true } }
        }
      })
    ])

    const bidderById = new Map(bidders.map(b => [b.id, b]))

    const photoResults = includePhotos
      ? await mapWithConcurrency(players, 6, p => embedPhoto(extractField((p.data as Record<string, unknown>) || {}, PHOTO_KEYS)))
      : []

    const resultRows = players.map((p, i) => {
      const data = (p.data as Record<string, unknown>) || {}
      const buyer = p.soldTo ? bidderById.get(p.soldTo) : undefined
      const row: Record<string, string | number> = {
        'Cricheroes Profile link': extractField(data, CRICHEROES_KEYS),
        'Player Name': extractField(data, NAME_KEYS),
        'Bidder Choice': p.isIcon ? 'Yes' : 'No',
        'Status': p.status,
        'Sold Price': p.soldPrice ?? '',
        'Sold To': buyer ? (buyer.teamName || buyer.username) : ''
      }
      if (includePhotos) {
        row['Photo (Base64)'] = photoResults[i].dataUri
        row['Photo Status'] = photoResults[i].status
      }
      return row
    })

    const bidderRows = bidders.map(b => ({
      'Team Name': b.teamName || '',
      'Username': b.username,
      'Bidder Name': b.user?.name || '',
      'Purse Amount': b.purseAmount,
      'Remaining Purse': b.remainingPurse
    }))

    // Auction-level configuration (min bid increment, countdown timer,
    // Bidder Choice quota, and anything else stored in this auction's
    // rules) - a flat Rule/Value sheet so the offline Control Room tool can
    // apply the same operating parameters instead of guessing defaults.
    const rules = (auction.rules as Record<string, unknown>) || {}
    const ruleRows = Object.entries(rules).map(([key, value]) => ({
      'Rule': key,
      'Value': typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resultRows), 'Results')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bidderRows), 'Bidders')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ruleRows), 'Rules')

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const safeName = auction.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/(^-|-$)/g, '')

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeName || 'auction'}-results.xlsx"`
      }
    })
  } catch (error) {
    console.error('Error exporting auction results:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
