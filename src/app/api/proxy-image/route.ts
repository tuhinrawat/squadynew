import { NextRequest, NextResponse } from 'next/server'
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

async function fetchDriveImage(fileId: string): Promise<{ contentType: string; buffer: ArrayBuffer }> {
  const imageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
  if (!response.ok) {
    throw new UpstreamFetchError(response.status)
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const buffer = await response.arrayBuffer()
  return { contentType, buffer }
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

    let pending = inFlight.get(fileId)
    if (!pending) {
      pending = fetchDriveImage(fileId)
      inFlight.set(fileId, pending)
      // Remove once settled (success or failure) so a later request for the
      // same id fetches fresh rather than being stuck sharing a failed or
      // long-gone promise.
      pending.finally(() => {
        if (inFlight.get(fileId) === pending) inFlight.delete(fileId)
      })
    }

    const { contentType, buffer } = await pending

    // Return the image with proper headers
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
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

