'use client'

import Pusher from 'pusher-js'
import { useEffect, useRef, useState } from 'react'

if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
  console.warn('Missing Pusher environment variables for client')
}

let pusherClient: Pusher | null = null

export function initializePusher(): Pusher {
  if (pusherClient) {
    return pusherClient
  }

  pusherClient = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    forceTLS: true,
  })

  return pusherClient
}

export interface AuctionEventData {
  'new-bid': {
    bidderId: string
    amount: number
    timestamp: string
    bidderName: string
    teamName?: string
    countdownSeconds: number
  }
  'bid-undo': {
    bidderId: string
    previousBid: number | null
    currentBid: any | null
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
    player: any
  }
  'timer-update': {
    seconds: number
  }
  'auction-paused': {}
  'auction-resumed': {}
  'auction-ended': {}
  'players-updated': {}
}

export type AuctionEventName = keyof AuctionEventData

export interface UsePusherOptions {
  onNewBid?: (data: AuctionEventData['new-bid']) => void
  onBidUndo?: (data: AuctionEventData['bid-undo']) => void
  onPlayerSold?: (data: AuctionEventData['player-sold']) => void
  onSaleUndo?: (data: AuctionEventData['sale-undo']) => void
  onNewPlayer?: (data: AuctionEventData['new-player']) => void
  onTimerUpdate?: (data: AuctionEventData['timer-update']) => void
  onAuctionPaused?: (data: AuctionEventData['auction-paused']) => void
  onAuctionResumed?: (data: AuctionEventData['auction-resumed']) => void
  onAuctionEnded?: (data: AuctionEventData['auction-ended']) => void
  onPlayersUpdated?: (data: AuctionEventData['players-updated']) => void
}

export function usePusher(auctionId: string, options: UsePusherOptions = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<any>(null)
  const pusherRef = useRef<Pusher | null>(null)

  useEffect(() => {
    if (!auctionId) return

    try {
      const pusher = initializePusher()
      pusherRef.current = pusher

      const channel = pusher.subscribe(`auction-${auctionId}`)
      channelRef.current = channel

      // Set up event listeners
      if (options.onNewBid) {
        channel.bind('new-bid', options.onNewBid)
      }
      if (options.onBidUndo) {
        channel.bind('bid-undo', options.onBidUndo)
      }
      if (options.onPlayerSold) {
        channel.bind('player-sold', options.onPlayerSold)
      }
      if (options.onSaleUndo) {
        channel.bind('sale-undo', options.onSaleUndo)
      }
      if (options.onNewPlayer) {
        channel.bind('new-player', options.onNewPlayer)
      }
      if (options.onTimerUpdate) {
        channel.bind('timer-update', options.onTimerUpdate)
      }
      if (options.onAuctionPaused) {
        channel.bind('auction-paused', options.onAuctionPaused)
      }
      if (options.onAuctionResumed) {
        channel.bind('auction-resumed', options.onAuctionResumed)
      }
      if (options.onAuctionEnded) {
        channel.bind('auction-ended', options.onAuctionEnded)
      }
      if (options.onPlayersUpdated) {
        channel.bind('players-updated', options.onPlayersUpdated)
      }

      // Connection status
      pusher.connection.bind('connected', () => {
        setIsConnected(true)
        setError(null)
      })

      pusher.connection.bind('disconnected', () => {
        setIsConnected(false)
      })

      pusher.connection.bind('error', (err: any) => {
        setError(err.message || 'Connection error')
        setIsConnected(false)
      })

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Pusher')
    }

    // Cleanup
    return () => {
      if (channelRef.current) {
        pusherRef.current?.unsubscribe(`auction-${auctionId}`)
        channelRef.current = null
      }
    }
  }, [auctionId, options])

  const disconnect = () => {
    if (pusherRef.current) {
      pusherRef.current.disconnect()
      pusherRef.current = null
    }
  }

  return {
    isConnected,
    error,
    disconnect,
  }
}

export function usePusherChannel(auctionId: string) {
  const [channel, setChannel] = useState<any>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!auctionId) return

    const pusher = initializePusher()
    const channel = pusher.subscribe(`auction-${auctionId}`)
    setChannel(channel)

    pusher.connection.bind('connected', () => setIsConnected(true))
    pusher.connection.bind('disconnected', () => setIsConnected(false))

    return () => {
      pusher.unsubscribe(`auction-${auctionId}`)
    }
  }, [auctionId])

  return { channel, isConnected }
}
