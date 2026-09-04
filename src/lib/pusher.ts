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
  'timer-update': {
    seconds: number
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
  'bid-error': {
    message: string
    bidderId?: string
    bidderName?: string
  }
}

export type AuctionEventName = keyof AuctionEventData

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
        metadata: { channel: channelName },
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

// For the handful of call sites that trigger a channel/event pair
// triggerAuctionEvent's typed AuctionEventData doesn't cover (viewer counts,
// chat messages, emoji reactions) - same timing/success telemetry, no type
// constraint on the event name or payload.
export function triggerRawPusherEvent(
  auctionId: string,
  eventName: string,
  data: unknown
): Promise<Pusher.Response> {
  const channelName = `auction-${auctionId}`
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
        metadata: { channel: channelName },
      })
      throw error
    })
}
