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
    timestamp: Date
    bidderName: string
    teamName?: string
  }
  'bid-undo': {
    bidderId: string
    previousBid: number
  }
  'player-sold': {
    playerId: string
    bidderId: string
    amount: number
    playerName: string
  }
  'sale-undo': {
    playerId: string
  }
  'new-player': {
    player: any // Will be typed properly when Player type is available
  }
  'timer-update': {
    seconds: number
  }
  'auction-paused': {}
  'auction-resumed': {}
  'auction-ended': {}
}

export type AuctionEventName = keyof AuctionEventData

export function triggerAuctionEvent<T extends AuctionEventName>(
  auctionId: string,
  eventName: T,
  data: AuctionEventData[T]
): Promise<Pusher.Response> {
  return pusher.trigger(`auction-${auctionId}`, eventName, data)
}

export function triggerAuctionEventToUser<T extends AuctionEventName>(
  userId: string,
  eventName: T,
  data: AuctionEventData[T]
): Promise<Pusher.Response> {
  return pusher.trigger(`user-${userId}`, eventName, data)
}