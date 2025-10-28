import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const fileId = searchParams.get('id')

    if (!url && !fileId) {
      return NextResponse.json({ error: 'Missing URL or file ID' }, { status: 400 })
    }

    let imageUrl = ''
    if (url) {
      imageUrl = url
    } else if (fileId) {
      // Extract file ID from Google Drive URL and convert to thumbnail
      imageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'Invalid URL or file ID' }, { status: 400 })
    }

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

