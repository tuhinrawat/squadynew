'use client'

import { useEffect, useState } from 'react'
import { initializePusher } from '@/lib/pusher-client'

export function useViewerCount(auctionId: string, shouldTrack: boolean = true) {
  const [viewerCount, setViewerCount] = useState(0)

  useEffect(() => {
    if (!auctionId || !shouldTrack) return

    let isActive = true

    // Join as viewer
    const joinViewer = async () => {
      try {
        const response = await fetch(`/api/auction/${auctionId}/viewers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join' })
        })
        const data = await response.json()
        if (isActive) {
          setViewerCount(data.count)
        }
      } catch (error) {
        console.error('Failed to join as viewer:', error)
      }
    }

    // Leave as viewer
    const leaveViewer = async () => {
      try {
        await fetch(`/api/auction/${auctionId}/viewers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'leave' })
        })
      } catch (error) {
        console.error('Failed to leave as viewer:', error)
      }
    }

    // Subscribe to viewer count updates via Pusher
    const pusher = initializePusher()
    const channel = pusher.subscribe(`auction-${auctionId}`)
    
    channel.bind('viewer-count-update', (data: { count: number }) => {
      if (isActive) {
        setViewerCount(data.count)
      }
    })

    // Join on mount
    joinViewer()

    // Cleanup on unmount
    return () => {
      isActive = false
      leaveViewer()
      channel.unbind('viewer-count-update')
      pusher.unsubscribe(`auction-${auctionId}`)
    }
  }, [auctionId, shouldTrack])

  return viewerCount
}

