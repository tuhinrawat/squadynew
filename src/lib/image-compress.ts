import { Jimp, JimpMime } from 'jimp'

// A small logo/photo has no reason to be larger than this on any screen this
// app renders it at (team logo thumbnails, player cards) - capping dimensions
// here is what keeps an uploaded image from becoming a multi-MB blob that
// then gets shipped in full to every viewer on every page load/poll.
const MAX_DIMENSION = 400
const JPEG_QUALITY = 82

// Resizes (if needed) and re-encodes an uploaded image as a compact JPEG data
// URL. Re-encoding as JPEG even for PNG/WebP input is deliberate: these are
// logos/photos, not graphics needing transparency or lossless detail, and
// JPEG at this quality is dramatically smaller than PNG for photographic
// content - which is what was actually driving the multi-MB payloads.
export async function compressImageToDataUrl(buffer: Buffer, maxDimension: number = MAX_DIMENSION): Promise<string> {
  const image = await Jimp.read(buffer)
  if (image.bitmap.width > maxDimension || image.bitmap.height > maxDimension) {
    image.scaleToFit({ w: maxDimension, h: maxDimension })
  }
  return image.getBase64(JimpMime.jpeg, { quality: JPEG_QUALITY })
}
