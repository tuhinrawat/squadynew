'use client'

import Pusher from 'pusher-js'
import { useEffect, useRef, useState } from 'react'

if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
  console.warn('Missing Pusher environment variables for client')
}

// Reports what only the browser can see - real receipt lag and real
// subscription health - to the observability dashboard. Fire-and-forget by
// design: a failed report must never affect the actual bidding UI, so this
// never throws and its result is never awaited by callers.
//
// sync_lag fires on every new-bid receipt, in every connected browser - so
// its request volume scales with audience size, not with server activity. A
// popular auction with hundreds of concurrent viewers would otherwise turn
// every single bid into a self-inflicted burst of simultaneous requests
// against this same server - the kind of thundering herd this whole system
// exists to catch, not cause. Sampling keeps the median/p95 statistically
// meaningful while keeping total volume flat regardless of crowd size.
// connected/connection_error/rebind are never sampled: they're inherently
// rare (one per session, not one per bid) and high-signal - losing any of
// them would hide the exact "why did it break" detail this was built for.
const SYNC_LAG_SAMPLE_RATE = 0.2

// Pusher's connection/subscription error objects rarely carry a plain
// .message string - the actual diagnostic detail (error type, close code)
// lives nested under .type / .data / .error.data. Without this, every
// connection_error report reads as an identical, useless "connection error"
// string no matter what actually went wrong.
function describePusherError(err: unknown): string {
  try {
    const e = err as { type?: string; message?: string; data?: { code?: number; message?: string }; error?: { data?: { code?: number; message?: string } } }
    const parts = [
      e?.type,
      e?.data?.code ?? e?.error?.data?.code,
      e?.data?.message ?? e?.error?.data?.message ?? e?.message,
    ].filter((p): p is string | number => p !== undefined && p !== null)
    if (parts.length > 0) return parts.join(' - ')
    return JSON.stringify(err).slice(0, 200)
  } catch {
    return 'unknown connection error'
  }
}

function reportClientEvent(
  auctionId: string,
  eventName: 'sync_lag' | 'connected' | 'connection_error' | 'rebind',
  extra: { latencyMs?: number; message?: string } = {}
) {
  if (eventName === 'sync_lag' && Math.random() >= SYNC_LAG_SAMPLE_RATE) {
    return
  }
  try {
    fetch('/api/observability/client-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auctionId, eventName, ...extra }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Never let telemetry reporting throw into the caller
  }
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
  'auction-paused': {}
  'auction-resumed': {}
  'auction-ended': {}
  'auction-reset': {}
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

export interface UsePusherOptions {
  onNewBid?: (data: AuctionEventData['new-bid']) => void
  onBidUndo?: (data: AuctionEventData['bid-undo']) => void
  onPlayerSold?: (data: AuctionEventData['player-sold']) => void
  onSaleUndo?: (data: AuctionEventData['sale-undo']) => void
  onNewPlayer?: (data: AuctionEventData['new-player']) => void
  onAuctionPaused?: (data: AuctionEventData['auction-paused']) => void
  onAuctionResumed?: (data: AuctionEventData['auction-resumed']) => void
  onAuctionEnded?: (data: AuctionEventData['auction-ended']) => void
  onAuctionReset?: (data: AuctionEventData['auction-reset']) => void
  onAuctionPoolExhausted?: (data: AuctionEventData['auction-pool-exhausted']) => void
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
      
      // Function to bind all event listeners (defined outside so it can be used in interval)
      const bindAllEvents = (channelToBind: any) => {
            console.log('[Pusher] bindAllEvents called', { channelName, hasOnNewBid: !!callbacksRef.current.onNewBid, channelSubscribed: channelToBind?.subscribed })
            // Unbind existing handlers first to avoid duplicates
            channelToBind.unbind('new-bid')
            channelToBind.unbind('bid-undo')
            channelToBind.unbind('player-sold')
            channelToBind.unbind('sale-undo')
            channelToBind.unbind('new-player')
            channelToBind.unbind('auction-paused')
            channelToBind.unbind('auction-resumed')
            channelToBind.unbind('auction-ended')
            channelToBind.unbind('auction-reset')
            channelToBind.unbind('auction-pool-exhausted')
            channelToBind.unbind('players-updated')
            channelToBind.unbind('bid-error')
            
            // Bind all event handlers
            channelToBind.bind('new-bid', (data: any) => {
              console.log('[Pusher] new-bid event received, calling callback', { hasCallback: !!callbacksRef.current.onNewBid, amount: data.amount })
              // Sync lag: time between the server stamping this bid and this
              // browser actually receiving it - the one thing "clogged"
              // literally means, measured directly instead of inferred.
              if (data?.timestamp) {
                const lag = Date.now() - new Date(data.timestamp).getTime()
                if (Number.isFinite(lag) && lag >= 0) {
                  reportClientEvent(auctionId, 'sync_lag', { latencyMs: lag })
                }
              }
              callbacksRef.current.onNewBid?.(data)
            })
            
            channelToBind.bind('bid-undo', (data: any) => {
              callbacksRef.current.onBidUndo?.(data)
            })
            
            channelToBind.bind('player-sold', (data: any) => {
              callbacksRef.current.onPlayerSold?.(data)
            })
            
            channelToBind.bind('sale-undo', (data: any) => {
              try {
                callbacksRef.current.onSaleUndo?.(data)
              } catch (error) {
                console.error('Error in sale-undo handler:', error)
              }
            })
            
            channelToBind.bind('new-player', (data: any) => {
              try {
                callbacksRef.current.onNewPlayer?.(data)
              } catch (error) {
                console.error('Error in new-player handler:', error)
              }
            })
            
            channelToBind.bind('auction-paused', (data: any) => {
              callbacksRef.current.onAuctionPaused?.(data)
            })
            
            channelToBind.bind('auction-resumed', (data: any) => {
              callbacksRef.current.onAuctionResumed?.(data)
            })
            
            channelToBind.bind('auction-ended', (data: any) => {
              callbacksRef.current.onAuctionEnded?.(data)
            })
            
            channelToBind.bind('auction-reset', (data: any) => {
              callbacksRef.current.onAuctionReset?.(data)
            })

            channelToBind.bind('auction-pool-exhausted', () => {
              callbacksRef.current.onAuctionPoolExhausted?.({})
            })
            
            channelToBind.bind('players-updated', (data: any) => {
              callbacksRef.current.onPlayersUpdated?.(data)
            })
            
            channelToBind.bind('bid-error', (data: any) => {
              callbacksRef.current.onBidError?.(data)
            })
          }
      
      const setupChannel = () => {
        // Always get the current channel instance (in case it was recreated)
        let channel: any = pusher.channel(channelName)
        let isNewChannel = false
        
        if (channel) {
          // Channel exists - use it
          channelRef.current = channel
          console.log('[Pusher] Using existing channel', { channelName, subscribed: channel.subscribed })
        } else {
          // Channel doesn't exist - subscribe to create it
          channel = pusher.subscribe(channelName)
          channelRef.current = channel
          isNewChannel = true
          console.log('[Pusher] Subscribing to new channel', { channelName })
        }
          
        // Always bind subscription events (for both new and existing channels)
        // Unbind first to avoid duplicate bindings
        channel.unbind('pusher:subscription_succeeded')
        channel.unbind('pusher:subscription_error')
        
        channel.bind('pusher:subscription_succeeded', () => {
          console.log('[Pusher] Subscription succeeded, binding events', { channelName })
          setIsConnected(true)
          reportClientEvent(auctionId, 'connected')
          // Bind events after subscription succeeds
          bindAllEvents(channel)
          // Mark as bound
          if (channelRef.current) {
            channelRef.current.callbacksBound = true
          }
        })

        channel.bind('pusher:subscription_error', (error: any) => {
          console.error('Pusher subscription error:', error)
          setError('Subscription failed')
          reportClientEvent(auctionId, 'connection_error', { message: `subscription_error: ${describePusherError(error)}` })
        })
        
        // Always try to bind events immediately if channel is subscribed
        // Also set up a delayed bind as a fallback in case subscription happens asynchronously
        if (channel.subscribed) {
          console.log('[Pusher] Channel already subscribed, binding events immediately', { channelName })
          setIsConnected(true)
          bindAllEvents(channel)
          if (channelRef.current) {
            channelRef.current.callbacksBound = true
          }
        } else {
          console.log('[Pusher] Channel not yet subscribed, will bind after subscription', { channelName })
          // Set up a fallback: bind events after a short delay in case subscription happens quickly
          setTimeout(() => {
            const currentChannel = pusher.channel(channelName) as any
            if (currentChannel && currentChannel.subscribed && !currentChannel.callbacksBound) {
              console.log('[Pusher] Fallback: binding events after delay', { channelName })
              bindAllEvents(currentChannel)
              // Mark as bound to avoid duplicate bindings
              if (currentChannel) {
                currentChannel.callbacksBound = true
              }
            }
          }, 100)
        }
      }
      
      // Setup channel immediately (Pusher will queue subscriptions if not connected yet)
      setupChannel()
      
      // Set up an interval to rebind events periodically (handles channel recreation)
      // This ensures we always have event handlers even if the channel is recreated
      const rebindInterval = setInterval(() => {
        const currentChannel = pusher.channel(channelName) as any
        if (currentChannel && currentChannel.subscribed) {
          // Check if this is a different channel instance
          if (channelRef.current !== currentChannel) {
            console.log('[Pusher] Channel instance changed, rebinding events', { channelName })
            channelRef.current = currentChannel
            bindAllEvents(currentChannel)
            if (currentChannel) {
              currentChannel.callbacksBound = true
            }
            reportClientEvent(auctionId, 'rebind', { message: 'channel instance changed' })
          } else if (!currentChannel.callbacksBound) {
            // Same channel but events not bound - rebind them
            console.log('[Pusher] Events not bound, rebinding', { channelName })
            bindAllEvents(currentChannel)
            currentChannel.callbacksBound = true
            reportClientEvent(auctionId, 'rebind', { message: 'callbacks were unbound' })
          }
        }
      }, 500) // Check every 500ms
      
      // Connection error handler
      const handleError = (err: any) => {
        const description = describePusherError(err)
        console.error('Connection error:', err)
        setError(description)
        reportClientEvent(auctionId, 'connection_error', { message: description })
      }

      pusher.connection.bind('error', handleError)

      // Cleanup
      return () => {
        clearInterval(rebindInterval)
        // Do NOTHING else in cleanup
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
