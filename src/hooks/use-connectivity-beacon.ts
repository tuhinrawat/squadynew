'use client'

import { useEffect, useRef, useState } from 'react'

const CHECK_INTERVAL_MS = 5000
const TIMEOUT_MS = 4000
// One blip shouldn't declare an outage; two in a row is a real signal.
// Recovery is optimistic - a single success flips back online immediately,
// since staying falsely flagged as offline is worse than one premature "back
// online" that a subsequent check would correct within 5 seconds anyway.
const FAILURES_BEFORE_OFFLINE = 2

// Proactively checks whether THIS DEVICE can actually reach the server -
// deliberately not navigator.onLine, which only reports whether the OS
// thinks it has a network interface up (it can report `true` on a wifi
// network with no real internet upstream, or `false` behind some captive
// portals that are actually fine). A real request to our own server is the
// only signal that means anything for "can I currently save an admin
// action." This is what lets the admin console detect an outage BEFORE the
// admin ever clicks a button that would fail, instead of only reacting
// after the fact.
export function useConnectivityBeacon(auctionId: string): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(true)
  const failureStreakRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const check = async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const response = await fetch(`/api/auction/${auctionId}/snapshot`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`Beacon check failed: HTTP ${response.status}`)
        failureStreakRef.current = 0
        if (!cancelled) setIsOnline(true)
      } catch {
        failureStreakRef.current += 1
        if (!cancelled && failureStreakRef.current >= FAILURES_BEFORE_OFFLINE) {
          setIsOnline(false)
        }
      } finally {
        clearTimeout(timeoutId)
        // Self-scheduling rather than setInterval - the next check only
        // starts after this one fully resolves, so a slow/hanging request
        // never causes checks to pile up concurrently.
        if (!cancelled) timer = setTimeout(check, CHECK_INTERVAL_MS)
      }
    }

    check()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [auctionId])

  return { isOnline }
}
