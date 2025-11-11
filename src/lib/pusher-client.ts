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

  // Enable Pusher logging only in development
  Pusher.logToConsole = process.env.NODE_ENV === 'development'

  pusherClient = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    forceTLS: true,
    enabledTransports: ['ws', 'wss'],
  })
  
  // Add connection state listeners for error tracking
  pusherClient.connection.bind('error', (err: any) => {
    console.error('Pusher connection error:', err)
  })
  
  pusherClient.connection.bind('failed', () => {
    console.error('Pusher connection failed')
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
    currentBid: {
      bidderId: string
      amount: number
      bidderName: string
      teamName?: string
    } | null
    countdownSeconds: number
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
  onBidError?: (data: AuctionEventData['bid-error']) => void
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

      const channelName = `auction-${auctionId}`
      
      const setupChannel = () => {
        // Get or subscribe to the channel
        const existingChannel = pusher.channel(channelName)
        let channel: any
        
        if (existingChannel) {
          channel = existingChannel
          channelRef.current = existingChannel
          if (existingChannel.subscribed) {
            setIsConnected(true)
          }
        } else {
          channel = pusher.subscribe(channelName)
          channelRef.current = channel
        }
        
        // Function to bind all event listeners (defined here so it can be used in both branches)
        const bindAllEvents = (channel: any) => {
            channel.bind('new-bid', (data: any) => {
              callbacksRef.current.onNewBid?.(data)
            })
            
            channel.bind('bid-undo', (data: any) => {
              callbacksRef.current.onBidUndo?.(data)
            })
            
            channel.bind('player-sold', (data: any) => {
              callbacksRef.current.onPlayerSold?.(data)
            })
            
            channel.bind('sale-undo', (data: any) => {
              try {
                callbacksRef.current.onSaleUndo?.(data)
              } catch (error) {
                console.error('Error in sale-undo handler:', error)
              }
            })
            
            channel.bind('new-player', (data: any) => {
              try {
                callbacksRef.current.onNewPlayer?.(data)
              } catch (error) {
                console.error('Error in new-player handler:', error)
              }
            })
            
            channel.bind('timer-update', (data: any) => {
              callbacksRef.current.onTimerUpdate?.(data)
            })
            
            channel.bind('auction-paused', (data: any) => {
              callbacksRef.current.onAuctionPaused?.(data)
            })
            
            channel.bind('auction-resumed', (data: any) => {
              callbacksRef.current.onAuctionResumed?.(data)
            })
            
            channel.bind('auction-ended', (data: any) => {
              callbacksRef.current.onAuctionEnded?.(data)
            })
            
            channel.bind('players-updated', (data: any) => {
              callbacksRef.current.onPlayersUpdated?.(data)
            })
            
            channel.bind('bid-error', (data: any) => {
              callbacksRef.current.onBidError?.(data)
            })
          }
          
        // Always bind subscription events (for both new and existing channels)
        // Unbind first to avoid duplicate bindings
        channel.unbind('pusher:subscription_succeeded')
        channel.unbind('pusher:subscription_error')
        
        channel.bind('pusher:subscription_succeeded', () => {
          setIsConnected(true)
          // Bind events after subscription succeeds
          bindAllEvents(channel)
        })
        
        channel.bind('pusher:subscription_error', (error: any) => {
          console.error('Pusher subscription error:', error)
          setError('Subscription failed')
        })
        
        // If channel is already subscribed, bind events immediately
        // Otherwise, events will be bound after subscription succeeds
        if (channel.subscribed) {
          setIsConnected(true)
          bindAllEvents(channel)
        }
      }
      
      // Setup channel immediately (Pusher will queue subscriptions if not connected yet)
      setupChannel()
      
      // Connection error handler
      const handleError = (err: any) => {
        console.error('Connection error:', err)
        setError(err.message || 'Connection error')
      }

      pusher.connection.bind('error', handleError)

      // Cleanup
      return () => {
        // Do NOTHING in cleanup
        // React 18 Strict Mode will call this and remount immediately
        // If we unbind anything, the channel bindings break and never recover
        // The channel and all bindings will persist across remounts
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Pusher')
    }
  }, [auctionId]) // Only depend on auctionId, not options
  // Note: callbacks are stored in refs and updated via useEffect, so bindings always use latest callbacks

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
