// The header a player-data spreadsheet uses for its Google Drive photo link
// varies a lot between organizers - this is every variant seen in the wild
// so far. It used to be copy-pasted (and drifting - only export-results/
// route.ts ever picked up 'Photo'/'Image'/'Drive Link') across every view
// that needs to render a player's photo; keeping it in one place means a
// sheet using a header none of these views expected yet only needs fixing
// here.
export const PROFILE_PHOTO_KEYS = [
  'Profile Photo',
  'profile photo',
  'Profile photo',
  'PROFILE PHOTO',
  'profile_photo',
  'ProfilePhoto',
  'Photo',
  'Image',
  'Drive Link',
]

export function extractProfilePhotoValue(data: Record<string, unknown> | null | undefined): string | undefined {
  for (const key of PROFILE_PHOTO_KEYS) {
    const value = data?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return undefined
}

export function extractGoogleDriveFileId(link: string): string | null {
  let match = link.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return match[1]
  match = link.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return match[1]
  return null
}

// Resolves a player's photo to this app's own proxy URL (bypasses Drive's
// CORB/CORS restrictions on hotlinking) - falls back to the raw value only
// when it's already a plain http(s) URL rather than a Drive link this can
// extract a file ID from.
//
// `width` requests a smaller (or larger) image from the proxy than its
// default - see proxy-image/route.ts's ALLOWED_WIDTHS. Every caller used to
// get a fixed 1000px image regardless of context, which is why a 60px grid
// thumbnail and the one large stage photo downloaded the same ~300KB file;
// pass the size that actually matches how the photo is displayed. Has no
// effect on an already-external http(s) URL, which this proxy doesn't
// control.
export function extractProxyImageUrl(data: Record<string, unknown> | null | undefined, width?: number): string | undefined {
  const value = extractProfilePhotoValue(data)
  if (!value) return undefined
  const fileId = extractGoogleDriveFileId(value)
  if (fileId) return `/api/proxy-image?id=${fileId}${width ? `&w=${width}` : ''}`
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return undefined
}
