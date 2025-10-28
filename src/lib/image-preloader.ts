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
 * Preload images with error handling (doesn't fail on individual errors)
 */
export async function preloadImagesSafe(urls: string[]): Promise<boolean> {
  try {
    await Promise.allSettled(urls.filter(url => url).map(url => preloadImage(url)))
    return true
  } catch (error) {
    console.warn('Some images failed to preload:', error)
    return false
  }
}

