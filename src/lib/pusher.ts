import Pusher from 'pusher'

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
    previousBid: number | null
    currentBid: any | null
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
  'sale-undo': {
    playerId: string
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
  'players-updated': {
    players?: any[] // Include player updates to avoid fetch
    bidders?: Array<{ id: string; remainingPurse: number }> // Include bidder updates
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
  return pusher.trigger(`auction-${auctionId}`, eventName, data)
}

export function triggerAuctionEventToUser<T extends AuctionEventName>(
  userId: string,
  eventName: T,
  data: AuctionEventData[T]
): Promise<Pusher.Response> {
  return pusher.trigger(`user-${userId}`, eventName, data)
}
