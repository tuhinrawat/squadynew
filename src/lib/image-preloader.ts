/**
 * Preload images for better performance
 * Uses the browser's image cache to load images before they're displayed
 */

export function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!url) {
      resolve()
      return
    }

    const img = new Image()
    // Every call site of this function is background warming (the next
    // player, or the whole roster ahead of time) - never the image someone
    // is actually waiting to see right now. Without this, the browser's own
    // network scheduler has no way to tell a background warm-up apart from
    // the current player's own live <img> fetch, and can let a 100+ request
    // sweep (see public-auction-view.tsx) compete with and delay the one
    // request that's actually visible on stage. Unsupported in a browser
    // just falls back to default priority - never an error.
    img.fetchPriority = 'low'
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/**
 * Preload multiple images in parallel
 */
export function preloadImages(urls: string[]): Promise<void[]> {
  return Promise.all(urls.filter(url => url).map(url => preloadImage(url)))
}

/**
 * Preload images with error handling (doesn't fail on individual errors),
 * in bounded-concurrency batches rather than all at once. Firing every URL
 * simultaneously would itself become a thundering-herd burst against
 * whatever's serving them (see proxy-image/route.ts's own reasoning for the
 * same concern server-side) and would compete for bandwidth with anything
 * else loading on the page at that moment.
 */
export async function preloadImagesSafe(urls: string[], batchSize = 6): Promise<boolean> {
  const valid = urls.filter(url => url)
  try {
    for (let i = 0; i < valid.length; i += batchSize) {
      await Promise.allSettled(valid.slice(i, i + batchSize).map(url => preloadImage(url)))
    }
    return true
  } catch (error) {
    console.warn('Some images failed to preload:', error)
    return false
  }
}

