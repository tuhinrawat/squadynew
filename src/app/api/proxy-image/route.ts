import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
export const dynamic = 'force-dynamic'

// Request coalescing: if N viewers request the same not-yet-cached photo in
// the same instant (e.g. 1000 people opening the auction the moment it goes
// live, each needing player photos nobody has viewed yet), each one used to
// fire its own independent fetch to Google Drive - a real thundering-herd
// bottleneck on a third party whose rate limits are outside this app's
// control. Concurrent requests for the same file id within the same warm
// serverless instance now share one in-flight fetch instead. This is a
// same-instance optimization, not a distributed cache - it doesn't collapse
// requests landing on different instances, but it removes the duplication
// that would otherwise happen on every one of them.
const inFlight = new Map<string, Promise<{ contentType: string; buffer: ArrayBuffer }>>()

class UpstreamFetchError extends Error {
  status: number
  constructor(status: number) {
    super(`Google Drive returned ${status}`)
    this.status = status
  }
}

// Every caller used to get a fixed 1000px-wide image regardless of where it
// was displayed - a 60px grid thumbnail and the one large stage photo both
// downloaded the same ~300KB file. That alone accounted for the large
// majority of this app's total outbound bandwidth on a real auction day
// (observed: ~83% of total egress from ~1,100 requests to this one route).
// An allowlist (rather than passing the query param straight through) keeps
// this from becoming an arbitrary-size proxy some caller could abuse to
// force oversized upstream fetches.
const ALLOWED_WIDTHS = [150, 200, 300, 400, 600, 800, 1000] as const
const DEFAULT_WIDTH = 400

function resolveWidth(param: string | null): number {
  const parsed = param ? Number(param) : NaN
  return ALLOWED_WIDTHS.includes(parsed as typeof ALLOWED_WIDTHS[number]) ? parsed : DEFAULT_WIDTH
}

// Same visible size and quality, fewer bytes: re-encode Drive's JPEG into
// whichever modern format the requesting browser already advertises via
// Accept (AVIF first, then WebP). Vercel's edge partitions its cache by the
// Accept header automatically, so different visitors safely get different
// encoded bytes for the same URL without a Vary header or separate cache
// keys here.
//
// The two quality numbers are NOT on the same scale, verified against real
// photos in this repo (public/*.jpg, public/*.jpeg): sharp/libaom's AVIF
// "quality" runs much more conservatively than libwebp's - quality:82 on
// both left AVIF *larger* than WebP, and only at ~quality:60-65 did AVIF
// pull meaningfully ahead of WebP's own 82, with no visible loss at 3x zoom
// on the same crop. WebP's 82 is the well-established safe default for
// JPEG-equivalent quality; AVIF's 63 was picked to land in that same visual
// range on this data, not by matching the number to WebP's.
const WEBP_QUALITY = 82
const AVIF_QUALITY = 63

function negotiateFormat(acceptHeader: string | null): 'avif' | 'webp' | null {
  if (!acceptHeader) return null
  if (acceptHeader.includes('image/avif')) return 'avif'
  if (acceptHeader.includes('image/webp')) return 'webp'
  return null
}

async function reencodeImage(buffer: ArrayBuffer, format: 'avif' | 'webp'): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const input = Buffer.from(buffer)
    const image = sharp(input)
    const output = format === 'avif'
      ? await image.avif({ quality: AVIF_QUALITY }).toBuffer()
      : await image.webp({ quality: WEBP_QUALITY }).toBuffer()
    return { buffer: output, contentType: `image/${format}` }
  } catch (error) {
    // Never let a re-encode failure (corrupt/unsupported source bytes) break
    // the image - fall back to serving the original, unmodified.
    console.error('Image re-encode failed, serving original:', error)
    return null
  }
}

// Drive's thumbnail endpoint is unofficial and unsupported - it doesn't
// always fail cleanly, it can just stall with no response and no error.
// Without a bound, that hung fetch's promise never settles, so it never
// leaves the inFlight map below (cleanup only runs on settle) - every later
// request for that exact photo, including after a hard refresh, then
// coalesces onto that same permanently-pending promise and spins forever.
const UPSTREAM_TIMEOUT_MS = 10000

async function fetchDriveImage(fileId: string, width: number): Promise<{ contentType: string; buffer: ArrayBuffer }> {
  const imageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new UpstreamFetchError(response.status)
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const buffer = await response.arrayBuffer()
    return { contentType, buffer }
  } finally {
    clearTimeout(timeout)
  }
}

// Only ever takes a Google Drive file id, never an arbitrary URL - every
// caller in this codebase already only ever passes `?id=` (the `?url=`
// variant this route used to accept was unused dead code, and accepting an
// arbitrary server-side-fetched URL from a query param is an open SSRF
// vector: it would let a request make this server fetch and return the
// contents of any URL, including internal/private addresses).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get('id')

    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      return NextResponse.json({ error: 'Missing or invalid file ID' }, { status: 400 })
    }

    const width = resolveWidth(searchParams.get('w'))
    // Different widths are different actual downloads - keying in-flight
    // coalescing and the (implicit, via the full request URL) edge cache by
    // fileId alone would either serve the wrong size or collapse two
    // legitimately different requests into one.
    const cacheKey = `${fileId}:${width}`

    let pending = inFlight.get(cacheKey)
    if (!pending) {
      pending = fetchDriveImage(fileId, width)
      inFlight.set(cacheKey, pending)
      // Remove once settled (success or failure) so a later request for the
      // same id fetches fresh rather than being stuck sharing a failed or
      // long-gone promise.
      pending.finally(() => {
        if (inFlight.get(cacheKey) === pending) inFlight.delete(cacheKey)
      })
    }

    const { contentType, buffer } = await pending

    // Coalescing above is keyed on fileId:width only (the raw Drive bytes
    // are format-independent), so re-encoding happens per-request, after
    // the shared fetch - each viewer's own Accept header picks its own
    // output format from the same downloaded original.
    const targetFormat = negotiateFormat(request.headers.get('accept'))
    let outBuffer: ArrayBuffer = buffer
    let outContentType = contentType
    if (targetFormat && !contentType.includes(targetFormat)) {
      const reencoded = await reencodeImage(buffer, targetFormat)
      if (reencoded) {
        // Node's Buffer type isn't a valid fetch BodyInit on its own (its
        // ArrayBufferLike generic doesn't match DOM's plain ArrayBuffer) -
        // slice out a real ArrayBuffer covering just these bytes.
        outBuffer = reencoded.buffer.buffer.slice(
          reencoded.buffer.byteOffset,
          reencoded.buffer.byteOffset + reencoded.buffer.byteLength
        ) as ArrayBuffer
        outContentType = reencoded.contentType
      }
    }

    // Return the image with proper headers
    return new NextResponse(outBuffer, {
      headers: {
        'Content-Type': outContentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Response body depends on the request's Accept header (avif vs webp
        // vs original) - without this, a cache that partitions by URL alone
        // can serve one visitor's re-encoded format to a different visitor
        // whose browser doesn't support it. Measured directly against this
        // app's own live deployment: at one width, a webp-accepting request
        // and an avif-accepting request for the exact same photo came back
        // byte-for-byte identical - two different codecs don't produce
        // identical output by chance, so something was already serving one
        // cached response for both. This header is the standard, explicit
        // fix regardless of a CDN's claimed default Accept-partitioning.
        'Vary': 'Accept',
      },
    })
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: error.status })
    }
    console.error('Error proxying image:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

