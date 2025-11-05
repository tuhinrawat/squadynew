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
    remainingPurse?: number // Added for instant UI updates
  }
  'bid-undo': {
    bidderId: string
    previousBid: number | null
    currentBid: any | null
    remainingPurse?: number // Added for instant UI updates
  }
  'player-sold': {
    playerId: string
    bidderId: string
    amount: number
    playerName: string
    bidderRemainingPurse?: number // Added for instant UI updates
    updatedBidders?: Array<{ id: string; remainingPurse: number }> // Batch updates
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
  
  // Store callbacks in refs to prevent re-subscription
  const callbacksRef = useRef<UsePusherOptions>(options)
  
  // Update callbacks ref when options change without re-subscribing
  useEffect(() => {
    callbacksRef.current = options
  }, [options])

  useEffect(() => {
    if (!auctionId) return

    try {
      const pusher = initializePusher()
      pusherRef.current = pusher

      const channel = pusher.subscribe(`auction-${auctionId}`)
      channelRef.current = channel

      // Set up event listeners using refs to get latest callbacks
      // Wrap each callback to always call the latest version from ref
      if (options.onNewBid) {
        channel.bind('new-bid', (data: any) => callbacksRef.current.onNewBid?.(data))
      }
      if (options.onBidUndo) {
        channel.bind('bid-undo', (data: any) => callbacksRef.current.onBidUndo?.(data))
      }
      if (options.onPlayerSold) {
        channel.bind('player-sold', (data: any) => callbacksRef.current.onPlayerSold?.(data))
      }
      if (options.onSaleUndo) {
        channel.bind('sale-undo', (data: any) => callbacksRef.current.onSaleUndo?.(data))
      }
      if (options.onNewPlayer) {
        channel.bind('new-player', (data: any) => callbacksRef.current.onNewPlayer?.(data))
      }
      if (options.onTimerUpdate) {
        channel.bind('timer-update', (data: any) => callbacksRef.current.onTimerUpdate?.(data))
      }
      if (options.onAuctionPaused) {
        channel.bind('auction-paused', (data: any) => callbacksRef.current.onAuctionPaused?.(data))
      }
      if (options.onAuctionResumed) {
        channel.bind('auction-resumed', (data: any) => callbacksRef.current.onAuctionResumed?.(data))
      }
      if (options.onAuctionEnded) {
        channel.bind('auction-ended', (data: any) => callbacksRef.current.onAuctionEnded?.(data))
      }
      if (options.onPlayersUpdated) {
        channel.bind('players-updated', (data: any) => callbacksRef.current.onPlayersUpdated?.(data))
      }

      // Connection status handlers
      const handleConnected = () => {
        setIsConnected(true)
        setError(null)
      }
      
      const handleDisconnected = () => {
        setIsConnected(false)
      }
      
      const handleError = (err: any) => {
        setError(err.message || 'Connection error')
        setIsConnected(false)
      }

      pusher.connection.bind('connected', handleConnected)
      pusher.connection.bind('disconnected', handleDisconnected)
      pusher.connection.bind('error', handleError)

      // Cleanup
      return () => {
        // Unbind all event listeners
        channel.unbind('new-bid')
        channel.unbind('bid-undo')
        channel.unbind('player-sold')
        channel.unbind('sale-undo')
        channel.unbind('new-player')
        channel.unbind('timer-update')
        channel.unbind('auction-paused')
        channel.unbind('auction-resumed')
        channel.unbind('auction-ended')
        channel.unbind('players-updated')
        
        // Unbind connection handlers
        pusher.connection.unbind('connected', handleConnected)
        pusher.connection.unbind('disconnected', handleDisconnected)
        pusher.connection.unbind('error', handleError)
        
        // Unsubscribe channel
        if (channelRef.current) {
          pusher.unsubscribe(`auction-${auctionId}`)
          channelRef.current = null
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Pusher')
    }
  }, [auctionId]) // Only depend on auctionId, not options

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
