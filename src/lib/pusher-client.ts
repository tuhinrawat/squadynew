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

  console.log('🔧 Initializing Pusher with key:', process.env.NEXT_PUBLIC_PUSHER_KEY?.substring(0, 10) + '...')
  console.log('🔧 Pusher cluster:', process.env.NEXT_PUBLIC_PUSHER_CLUSTER)

  // Enable Pusher logging for debugging
  Pusher.logToConsole = true

  pusherClient = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    forceTLS: true,
    enabledTransports: ['ws', 'wss'],
  })
  
  // Add connection state listeners
  pusherClient.connection.bind('connected', () => {
    console.log('✅ Pusher connection established')
  })
  
  pusherClient.connection.bind('disconnected', () => {
    console.log('❌ Pusher connection disconnected')
  })
  
  pusherClient.connection.bind('error', (err: any) => {
    console.error('❌ Pusher connection error:', err)
  })
  
  pusherClient.connection.bind('failed', () => {
    console.error('❌ Pusher connection failed')
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
      console.log('🔌 Attempting to subscribe to Pusher channel:', channelName)
      console.log('🔌 Pusher connection state:', pusher.connection.state)
      
      const setupChannel = () => {
        // Get or subscribe to the channel
        const existingChannel = pusher.channel(channelName)
        let channel: any
        
        if (existingChannel) {
          console.log('♻️ Channel already exists, reusing it')
          channel = existingChannel
          channelRef.current = existingChannel
          if (existingChannel.subscribed) {
            setIsConnected(true)
          }
        } else {
          console.log('📡 Creating new channel subscription')
          channel = pusher.subscribe(channelName)
          channelRef.current = channel
          
          console.log('📍 Channel state after subscribe:', {
            name: channel.name,
            subscribed: channel.subscribed,
            subscriptionPending: channel.subscriptionPending,
            subscriptionCancelled: channel.subscriptionCancelled
          })
        }
        
        // Function to bind all event listeners (defined here so it can be used in both branches)
        const bindAllEvents = (channel: any) => {
            console.log('🔗 Binding ALL event listeners')
            console.log('🔗 Current callbacks available:', {
              onNewBid: !!callbacksRef.current.onNewBid,
              onBidUndo: !!callbacksRef.current.onBidUndo,
              onPlayerSold: !!callbacksRef.current.onPlayerSold,
              onSaleUndo: !!callbacksRef.current.onSaleUndo,
              onNewPlayer: !!callbacksRef.current.onNewPlayer,
              onTimerUpdate: !!callbacksRef.current.onTimerUpdate,
              onAuctionPaused: !!callbacksRef.current.onAuctionPaused,
              onAuctionResumed: !!callbacksRef.current.onAuctionResumed,
              onAuctionEnded: !!callbacksRef.current.onAuctionEnded,
              onPlayersUpdated: !!callbacksRef.current.onPlayersUpdated,
            })
            
            channel.bind('new-bid', (data: any) => {
              console.log('📨 Pusher received new-bid:', data)
              callbacksRef.current.onNewBid?.(data)
            })
            
            channel.bind('bid-undo', (data: any) => {
              console.log('📨 Pusher client received bid-undo event:', data)
              callbacksRef.current.onBidUndo?.(data)
            })
            
            channel.bind('player-sold', (data: any) => {
              console.log('📨 Pusher received player-sold:', data)
              callbacksRef.current.onPlayerSold?.(data)
            })
            
            // Create a named function for sale-undo to ensure it's properly tracked by Pusher
            const handleSaleUndoEvent = (data: any) => {
              console.log('📨 Pusher received sale-undo event:', data)
              console.log('📨 Callbacks ref has onSaleUndo?', !!callbacksRef.current.onSaleUndo)
              if (callbacksRef.current.onSaleUndo) {
                console.log('✅ Calling onSaleUndo callback')
                try {
                  callbacksRef.current.onSaleUndo(data)
                } catch (error) {
                  console.error('❌ Error calling onSaleUndo:', error)
                }
              } else {
                console.error('❌ onSaleUndo callback is missing from callbacksRef!')
                console.log('📨 Current callbacks:', Object.keys(callbacksRef.current))
              }
            }
            channel.bind('sale-undo', handleSaleUndoEvent)
            console.log('✅ Bound sale-undo event handler')
            
            // Create a named function for new-player to ensure it's properly tracked by Pusher
            const handleNewPlayerEvent = (data: any) => {
              console.log('📨 Pusher received new-player event:', data)
              console.log('📨 Callbacks ref has onNewPlayer?', !!callbacksRef.current.onNewPlayer)
              if (callbacksRef.current.onNewPlayer) {
                console.log('✅ Calling onNewPlayer callback')
                try {
                  callbacksRef.current.onNewPlayer(data)
                } catch (error) {
                  console.error('❌ Error calling onNewPlayer:', error)
                }
              } else {
                console.error('❌ onNewPlayer callback is missing from callbacksRef!')
                console.log('📨 Current callbacks:', Object.keys(callbacksRef.current))
              }
            }
            channel.bind('new-player', handleNewPlayerEvent)
            console.log('✅ Bound new-player event handler')
            
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
              console.log('📨 Pusher received players-updated:', data)
              callbacksRef.current.onPlayersUpdated?.(data)
            })
            
            channel.bind('bid-error', (data: any) => {
              console.log('📨 Pusher received bid-error:', data)
              callbacksRef.current.onBidError?.(data)
            })
            
            console.log('✅ All event handlers bound successfully')
          }
          
        // Always bind subscription events (for both new and existing channels)
        // Unbind first to avoid duplicate bindings
        channel.unbind('pusher:subscription_succeeded')
        channel.unbind('pusher:subscription_error')
        
        channel.bind('pusher:subscription_succeeded', () => {
          console.log('✅ Pusher subscription successful:', channelName)
          setIsConnected(true)
          // Bind events after subscription succeeds
          bindAllEvents(channel)
        })
        
        channel.bind('pusher:subscription_error', (error: any) => {
          console.error('❌ Pusher subscription error:', channelName, error)
          setError('Subscription failed')
        })
        
        // If channel is already subscribed, bind events immediately
        // Otherwise, events will be bound after subscription succeeds
        if (channel.subscribed) {
          console.log('✅ Channel already subscribed, setting connected state and binding events')
          setIsConnected(true)
          bindAllEvents(channel)
        } else {
          console.log('⏳ Channel not yet subscribed, events will be bound after subscription succeeds')
        }
      }
      
      // Setup channel immediately (Pusher will queue subscriptions if not connected yet)
      setupChannel()
      
      // Connection status handlers - these are redundant, already handled in initializePusher
      const handleConnected = () => {
        console.log('🔄 Connection state changed to connected')
      }
      
      const handleDisconnected = () => {
        console.log('🔄 Connection state changed to disconnected')
      }
      
      const handleError = (err: any) => {
        console.error('🔄 Connection error:', err)
        setError(err.message || 'Connection error')
      }

      pusher.connection.bind('state_change', (states: any) => {
        console.log('🔄 Pusher connection state change:', states.previous, '→', states.current)
      })
      pusher.connection.bind('connected', handleConnected)
      pusher.connection.bind('disconnected', handleDisconnected)
      pusher.connection.bind('error', handleError)

      // Cleanup
      return () => {
        console.log('🧹 Cleanup called for:', channelName, '- doing nothing to preserve Pusher bindings')
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
