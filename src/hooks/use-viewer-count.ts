'use client'

import { useEffect, useState } from 'react'

// Polling interval for refreshing the viewer count. This used to be a live
// Pusher broadcast on every join/leave - meaning every single viewer joining
// or leaving fired a message to every OTHER connected viewer, an entire
// category of Pusher volume that scaled with audience churn, not just
// audience size. A polled count is a few seconds stale, which is fine for a
// number nobody is making split-second decisions on.
const POLL_INTERVAL_MS = 10000

export function useViewerCount(auctionId: string, shouldTrack: boolean = true) {
  const [viewerCount, setViewerCount] = useState(0)

  useEffect(() => {
    if (!auctionId || !shouldTrack) return

    let isActive = true

    // Join as viewer - registers presence and returns the count immediately
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

    // Leave as viewer. keepalive lets this survive a tab close/navigation
    // that would otherwise cancel an in-flight fetch.
    const leaveViewer = () => {
      fetch(`/api/auction/${auctionId}/viewers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave' }),
        keepalive: true,
      }).catch(() => {})
    }

    const pollCount = async () => {
      try {
        const response = await fetch(`/api/auction/${auctionId}/viewers`)
        const data = await response.json()
        if (isActive) {
          setViewerCount(data.count)
        }
      } catch (error) {
        console.error('Failed to poll viewer count:', error)
      }
    }

    joinViewer()
    const interval = setInterval(pollCount, POLL_INTERVAL_MS)

    // Cleanup on unmount
    return () => {
      isActive = false
      clearInterval(interval)
      leaveViewer()
    }
  }, [auctionId, shouldTrack])

  return viewerCount
}
