import Pusher from 'pusher'
import { logEventAsync } from '@/lib/observability'

if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
  throw new Error('Missing Pusher environment variables')
}

export const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
})

export interface AuctionEventData {
  'new-bid': {
    bidderId: string
    amount: number
    timestamp: Date | string
    bidderName: string
    teamName?: string
    countdownSeconds: number
    remainingPurse?: number // Include purse update for instant UI
  }
  'bid-undo': {
    bidderId: string
    currentBid: {
      bidderId: string
      amount: number
      bidderName: string
      teamName?: string
    } | null
    countdownSeconds: number
    remainingPurse?: number // Include purse update
  }
  'player-sold': {
    playerId: string
    bidderId: string
    amount: number
    playerName: string
    bidderName?: string
    teamName?: string
    bidderRemainingPurse?: number // Include purse update
    updatedBidders?: Array<{ id: string; remainingPurse: number }> // Batch purse updates
  }
  'player-unsold': {
    playerId: string
    playerName: string
  }
  'sale-undo': {
    playerId: string
    player?: any // Updated player data after undo
    bidderId?: string
    refundedAmount?: number
    bidderRemainingPurse?: number
    updatedBidders?: Array<{ id: string; remainingPurse: number }>
  }
  'new-player': {
    player: any
  }
  'auction-paused': {}
  'auction-resumed': {}
  'auction-ended': {}
  'auction-reset': {}
  // The pool of players ran out (nothing AVAILABLE, nothing UNSOLD left to
  // recycle) after a sale - distinct from 'new-player' so every connected
  // screen can show a clear completion state instead of freezing on the
  // last-sold player forever, since no 'new-player' event follows this one.
  'auction-pool-exhausted': Record<string, never>
  'players-updated': {
    players?: any[] // Include player updates to avoid fetch
    bidders?: Array<{ id: string; remainingPurse: number }> // Include bidder updates
  }
}

export type AuctionEventName = keyof AuctionEventData

// Events delivered only to the admin console, on a channel nobody else
// subscribes to - so a rejected/invalid bid attempt (which can happen a lot
// during a live event) never gets multiplied by the auction's public
// viewer count the way a broadcast on the shared auction-{id} channel would.
export interface AdminEventData {
  'bid-error': {
    message: string
    bidderId?: string
    bidderName?: string
  }
}

export type AdminEventName = keyof AdminEventData

// The pusher npm package throws a PusherRequestError with .status and .body
// attached whenever Pusher's REST API responds with an HTTP error (verified
// in node_modules/pusher/lib/requests.js - it does `throw new
// errors.RequestError("Unexpected status code " + res.status, url, err,
// res.status, body)`). A network-level failure (couldn't reach Pusher at
// all) throws the same error type but with no .status/.body. Capturing
// these lets the observability dashboard show the actual HTTP status and
// response body Pusher sent back, instead of just a generic message.
function extractPusherErrorDetail(error: unknown): { status?: number; body?: string } {
  const e = error as { status?: number; body?: string }
  return { status: e?.status, body: typeof e?.body === 'string' ? e.body.slice(0, 500) : undefined }
}

// Optimized trigger with non-blocking promise
export function triggerAuctionEvent<T extends AuctionEventName>(
  auctionId: string,
  eventName: T,
  data: AuctionEventData[T]
): Promise<Pusher.Response> {
  // Fire and forget for critical path - don't wait for Pusher response
  // The promise will resolve in background
  const channelName = `auction-${auctionId}`
  const start = Date.now()
  console.log(`🚀 Pusher trigger: channel=${channelName}, event=${eventName}`)
  return pusher.trigger(channelName, eventName, data)
    .then(response => {
      console.log(`✅ Pusher trigger successful: channel=${channelName}, event=${eventName}`, response)
      logEventAsync({
        category: 'pusher',
        eventName,
        auctionId,
        success: true,
        latencyMs: Date.now() - start,
        metadata: { channel: channelName },
      })
      return response
    })
    .catch(error => {
      console.error(`❌ Pusher trigger failed: channel=${channelName}, event=${eventName}`, error)
      logEventAsync({
        category: 'pusher',
        eventName,
        auctionId,
        success: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
        metadata: { channel: channelName, ...extractPusherErrorDetail(error) },
      })
      throw error
    })
}

export function triggerAuctionEventToUser<T extends AuctionEventName>(
  userId: string,
  eventName: T,
  data: AuctionEventData[T]
): Promise<Pusher.Response> {
  return pusher.trigger(`user-${userId}`, eventName, data)
}

// Same fire-and-forget/telemetry shape as triggerAuctionEvent, but targets
// admin-{auctionId} instead of the shared auction-{auctionId} channel - see
// AdminEventData above for why.
export function triggerAdminEvent<T extends AdminEventName>(
  auctionId: string,
  eventName: T,
  data: AdminEventData[T]
): Promise<Pusher.Response> {
  const channelName = `admin-${auctionId}`
  const start = Date.now()
  return pusher.trigger(channelName, eventName, data)
    .then(response => {
      logEventAsync({
        category: 'pusher',
        eventName,
        auctionId,
        success: true,
        latencyMs: Date.now() - start,
        metadata: { channel: channelName },
      })
      return response
    })
    .catch(error => {
      logEventAsync({
        category: 'pusher',
        eventName,
        auctionId,
        success: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
        metadata: { channel: channelName, ...extractPusherErrorDetail(error) },
      })
      throw error
    })
}
