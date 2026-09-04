import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

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

    // Extract file ID from Google Drive URL and convert to thumbnail
    const imageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`

    // Fetch the image from Google Drive
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: response.status })
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const imageBuffer = await response.arrayBuffer()

    // Return the image with proper headers
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Error proxying image:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

