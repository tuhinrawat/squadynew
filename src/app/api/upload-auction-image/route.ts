import { NextRequest, NextResponse } from 'next/server'
import { compressImageToDataUrl } from '@/lib/image-compress'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      )
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed' },
        { status: 400 }
      )
    }

    // Validate file size (input cap - the stored result is always compressed
    // down to a small size below, this just bounds how much we'll process)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB' },
        { status: 400 }
      )
    }

    // Store as a compressed data URL (works on serverless platforms with no
    // persistent disk/object storage configured) - resizing and re-encoding
    // here is what keeps this from becoming a multi-MB database blob that
    // then ships in full to every viewer on every page load. Falls back to
    // the raw upload for formats Jimp can't decode (WebP isn't supported by
    // the installed plugin set, SVG is vector so compression doesn't apply)
    // rather than failing the upload outright.
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    let dataUrl: string
    if (file.type === 'image/svg+xml') {
      dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`
    } else {
      try {
        dataUrl = await compressImageToDataUrl(buffer)
      } catch (compressError) {
        console.error('Image compression failed, storing original:', compressError)
        dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`
      }
    }

    return NextResponse.json({
      success: true,
      imageUrl: dataUrl,
      message: 'Image uploaded successfully'
    })
  } catch (error) {
    console.error('Error uploading image:', error)
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    )
  }
}

