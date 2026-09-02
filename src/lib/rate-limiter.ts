// Sliding-window rate limiter, originally built for the chat route, extracted here
// so other high-frequency mutating routes (e.g. bidding) can reuse the same protection.
//
// Known limitation: state lives in this process's memory. On a serverless deployment
// (this app runs on Vercel) concurrent requests can land on different function
// instances, each with its own empty Map, so a determined client can bypass the limit
// by fanning requests across instances. That's a real gap, but it still stops the
// common case (a single buggy/looping client, or someone mashing a button) without
// requiring new infrastructure. Swapping this for a Redis-backed store later is a
// drop-in change — only the internals of `check()` need to move, callers don't change.
export class RateLimiter {
  private timestamps: Map<string, number[]> = new Map()
  private readonly windowMs: number
  private readonly maxRequests: number
  private cleanupInterval: NodeJS.Timeout

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests

    // Cleanup old entries every minute to prevent memory leak
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000)
    // Don't keep the process alive just for this timer (matters for scripts/tests)
    this.cleanupInterval.unref?.()
  }

  check(key: string): { allowed: boolean; remaining: number } {
    const now = Date.now()
    const userTimestamps = this.timestamps.get(key) || []

    // Remove timestamps outside the window
    const recentTimestamps = userTimestamps.filter(t => now - t < this.windowMs)

    if (recentTimestamps.length >= this.maxRequests) {
      this.timestamps.set(key, recentTimestamps)
      return { allowed: false, remaining: 0 }
    }

    // Add current timestamp
    recentTimestamps.push(now)
    this.timestamps.set(key, recentTimestamps)

    return {
      allowed: true,
      remaining: this.maxRequests - recentTimestamps.length
    }
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of this.timestamps.entries()) {
      const recent = timestamps.filter(t => now - t < this.windowMs)
      if (recent.length === 0) {
        this.timestamps.delete(key)
      } else {
        this.timestamps.set(key, recent)
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval)
  }
}
