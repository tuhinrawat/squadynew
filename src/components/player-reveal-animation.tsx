'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'

interface PlayerRevealAnimationProps {
  allPlayerNames: string[]
  finalPlayerName: string
  onComplete: () => void
  duration?: number // Duration in milliseconds spent rumbling before the name locks in (default 5000ms)
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// The lock-in + camera-flash + hold sequence always fits inside this window,
// no matter how long the player's name is - so the total time to onComplete
// stays a fixed `duration + LOCK_WINDOW`, exactly like the previous version.
// The admin console's stuck-reveal safety timeouts are tuned against that
// same total, so this budget must not grow.
const LOCK_WINDOW = 1500

export function PlayerRevealAnimation({
  finalPlayerName,
  onComplete,
  duration = 5000
}: PlayerRevealAnimationProps) {
  const [letters, setLetters] = useState<string[]>([])
  const [lockedCount, setLockedCount] = useState(0)
  const [isLocking, setIsLocking] = useState(false)
  const [flash, setFlash] = useState(false)

  const animationFrameRef = useRef<number | null>(null)
  const animateRef = useRef<() => void>(() => {})
  const timeoutsRef = useRef<NodeJS.Timeout[]>([])
  const onCompleteRef = useRef(onComplete)
  const startTimeRef = useRef<number>(0)
  const lastUpdateRef = useRef<number>(0)
  const phaseRef = useRef<'fast' | 'slow' | 'locking'>('fast')
  const finalNameRef = useRef<string>(finalPlayerName)

  useEffect(() => {
    onCompleteRef.current = onComplete
    finalNameRef.current = finalPlayerName
  }, [onComplete, finalPlayerName])

  const getRandomLetter = useCallback(() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)], [])

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
  }, [])

  const after = useCallback((ms: number, fn: () => void) => {
    timeoutsRef.current.push(setTimeout(fn, ms))
  }, [])

  // Locks the rumbling letters into the real name, left to right - like a
  // scoreboard's columns clacking into place one at a time - then flashes
  // and hands off to onComplete once the name has held for a beat.
  const runLockSequence = useCallback(() => {
    phaseRef.current = 'locking'
    setIsLocking(true)
    const name = finalNameRef.current
    const chars = name.split('')
    const lockable = chars.map((c, i) => ({ c, i })).filter(({ c }) => c !== ' ')
    const perLetterDelay = lockable.length > 0 ? Math.min(120, (LOCK_WINDOW * 0.55) / lockable.length) : 0

    lockable.forEach(({ i }, seq) => {
      after(seq * perLetterDelay, () => {
        setLetters(prev => {
          const next = [...prev]
          next[i] = chars[i]
          return next
        })
        setLockedCount(seq + 1)
      })
    })

    const lockFinishesAt = lockable.length * perLetterDelay
    after(lockFinishesAt + 60, () => {
      setFlash(true)
      after(90, () => setFlash(false))
    })

    after(LOCK_WINDOW, () => {
      onCompleteRef.current()
    })
  }, [after])

  const animate = useCallback(() => {
    const now = Date.now()
    const elapsed = now - startTimeRef.current
    const remaining = duration - elapsed

    if (remaining <= 0) {
      runLockSequence()
      return
    }

    if (remaining <= 1500 && phaseRef.current === 'fast') {
      phaseRef.current = 'slow'
    }

    const timeSinceLastUpdate = now - lastUpdateRef.current
    const updateInterval = phaseRef.current === 'fast' ? 100 : 200

    if (timeSinceLastUpdate >= updateInterval) {
      const name = finalNameRef.current
      setLetters(name.split('').map(c => (c === ' ' ? ' ' : getRandomLetter())))
      lastUpdateRef.current = now
    }

    animationFrameRef.current = requestAnimationFrame(() => animateRef.current())
  }, [duration, getRandomLetter, runLockSequence])

  useEffect(() => {
    animateRef.current = animate
  }, [animate])

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    clearAllTimeouts()

    const now = Date.now()
    startTimeRef.current = now
    lastUpdateRef.current = now
    phaseRef.current = 'fast'

    const name = finalNameRef.current
    setLetters(name.split('').map(c => (c === ' ' ? ' ' : getRandomLetter())))

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      clearAllTimeouts()
    }
  }, [animate, clearAllTimeouts, getRandomLetter])

  const lockableTotal = letters.filter(l => l !== ' ').length
  const fullyLocked = isLocking && lockableTotal > 0 && lockedCount >= lockableTotal

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md rounded-xl overflow-hidden"
      style={{ willChange: 'transform, opacity' }}
    >
      <div className="relative w-full h-full overflow-hidden">
        {/* Search-light beams sweeping the dark stage */}
        <motion.div
          className="absolute -top-[20%] left-[-10%] w-24 h-[160%] origin-top bg-gradient-to-b from-amber-400/20 to-transparent blur-sm"
          animate={{ rotate: [-18, 10, -18] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -top-[20%] right-[-10%] w-24 h-[160%] origin-top bg-gradient-to-b from-amber-400/20 to-transparent blur-sm"
          animate={{ rotate: [18, -10, 18] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Ambient ground-level haze */}
        <motion.div
          animate={{ scale: [1, 1.08, 1], opacity: [0.15, 0.3, 0.15] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-64 h-64 bg-teal-500/20 rounded-full blur-3xl"
          style={{ willChange: 'transform, opacity' }}
        />

        {/* Spotlight landing on center stage */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-72 h-72 sm:w-80 sm:h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,238,204,0.35) 0%, rgba(245,196,83,0.14) 45%, rgba(245,196,83,0) 72%)' }}
        />

        {/* Camera flash on lock */}
        <div
          className="absolute inset-0 bg-white pointer-events-none transition-opacity duration-75"
          style={{ opacity: flash ? 0.5 : 0 }}
        />

        {/* Content */}
        <div className="relative w-full h-full flex flex-col items-center justify-center px-4">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] text-amber-300/70 mb-3 sm:mb-4">
            Next Lot
          </span>

          <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 max-w-full font-['Montserrat']">
            {letters.map((letter, index) => (
              <span
                key={index}
                className={
                  letter === ' '
                    ? 'inline-block w-3 sm:w-4'
                    : `inline-block font-black uppercase text-2xl sm:text-4xl transition-colors duration-150 ${
                        index < lockedCount
                          ? 'animate-in zoom-in-50 duration-300 text-amber-300 drop-shadow-[0_0_14px_rgba(245,196,83,0.75)]'
                          : 'text-amber-100/40'
                      }`
                }
              >
                {letter}
              </span>
            ))}
          </div>

          <span className="mt-4 sm:mt-6 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-400">
            {fullyLocked ? 'On the clock — bidding opens now' : isLocking ? 'Locking it in…' : 'Rolling the lot…'}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
