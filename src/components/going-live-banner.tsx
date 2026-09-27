'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

interface GoingLiveBannerProps {
  show: boolean
  onComplete?: () => void
}

const REVEAL_WORDS = ['LIVE', 'AUCTION']
const SHUFFLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function randomChar() {
  return SHUFFLE_CHARS[Math.floor(Math.random() * SHUFFLE_CHARS.length)]
}

// One letter of the reveal text - cycles through random characters, then
// locks onto its real character at `lockAtMs` after the shuffle phase
// starts. Staggering each letter's lock time is what produces the
// left-to-right "slot reel" cascade instead of every letter settling at
// once. Inactive (curtains not yet closed) it just shows the real letter,
// invisible behind the parent's own opacity until the shuffle phase begins.
function ShuffleLetter({ char, active, lockAtMs }: { char: string; active: boolean; lockAtMs: number }) {
  const [display, setDisplay] = useState(char)

  useEffect(() => {
    if (!active) return
    const shuffleInterval = setInterval(() => setDisplay(randomChar()), 50)
    const lockTimeout = setTimeout(() => {
      clearInterval(shuffleInterval)
      setDisplay(char)
    }, lockAtMs)
    return () => {
      clearInterval(shuffleInterval)
      clearTimeout(lockTimeout)
    }
  }, [active, char, lockAtMs])

  return <span className="inline-block w-[0.65em] text-center">{display}</span>
}

// Full-screen "the auction is starting" moment: a theater curtain drops over
// whatever the screen was showing, a slot-reel shuffle spells out LIVE
// AUCTION while it's closed, then the curtain draws back open onto the
// current player card underneath. Total runtime (10s) matches the window
// callers wait before flipping `show` back to false - see the matching
// setTimeout in each caller (admin-auction-view, public-auction-view,
// countdown-to-live-wrapper).
export function GoingLiveBanner({ show, onComplete }: GoingLiveBannerProps) {
  const [phase, setPhase] = useState<'idle' | 'closing' | 'shuffle' | 'opening'>('idle')
  // Adjust state during render (React's own recommended pattern for "reset
  // this state when a prop changes") rather than a useEffect - reflects
  // `show` flipping immediately, without an extra render pass in between.
  const [trackedShow, setTrackedShow] = useState(show)
  if (show !== trackedShow) {
    setTrackedShow(show)
    setPhase(show ? 'closing' : 'idle')
  }

  // Only the LATER staged transitions genuinely need an effect - they're
  // tied to wall-clock time, not derivable from props during render.
  useEffect(() => {
    if (!show) return
    const toShuffle = setTimeout(() => setPhase('shuffle'), 700)
    const toOpening = setTimeout(() => setPhase('opening'), 8700)
    const toComplete = setTimeout(() => onComplete?.(), 10000)
    return () => {
      clearTimeout(toShuffle)
      clearTimeout(toOpening)
      clearTimeout(toComplete)
    }
  }, [show, onComplete])

  if (phase === 'idle') return null

  const curtainsClosed = phase === 'closing' || phase === 'shuffle'
  const textVisible = phase === 'shuffle'
  // Precomputed functionally (no mutable counter across the render) - each
  // letter's lock-in time is 85ms after the previous one, counted across
  // the whole phrase so the cascade continues smoothly from word to word.
  const words = REVEAL_WORDS.reduce<Array<{ word: string; letters: Array<{ char: string; lockAtMs: number }> }>>(
    (acc, word) => {
      const startIndex = acc.reduce((sum, w) => sum + w.letters.length, 0)
      const letters = word.split('').map((char, i) => ({ char, lockAtMs: 280 + (startIndex + i) * 85 }))
      return [...acc, { word, letters }]
    },
    []
  )

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden" aria-hidden="true">
      {/* Spotlight glow behind the curtain seam, visible only while closed */}
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: curtainsClosed ? 1 : 0 }}
        transition={{ duration: 0.4 }}
        style={{ background: 'radial-gradient(circle at 50% 50%, rgba(251,191,36,0.18), transparent 55%)' }}
      />

      {/* Top curtain - starts off-screen above and drops down to cover */}
      <motion.div
        className="absolute inset-x-0 top-0 h-1/2"
        initial={{ y: '-100%' }}
        animate={{ y: curtainsClosed ? '0%' : '-100%' }}
        transition={{ duration: 0.6, ease: [0.65, 0, 0.35, 1] }}
        style={{
          background: 'linear-gradient(180deg, #4a0d12 0%, #7a1522 45%, #5c0f18 100%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
        }}
      >
        {/* Velvet fold texture */}
        <div
          className="absolute inset-0 opacity-40"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 14px, rgba(255,255,255,0.06) 14px, rgba(255,255,255,0.06) 28px)' }}
        />
        <div className="absolute bottom-0 inset-x-0 h-2" style={{ background: 'linear-gradient(90deg, #d4af37, #f5e08a, #d4af37)' }} />
      </motion.div>

      {/* Bottom curtain - starts off-screen below and rises up to cover */}
      <motion.div
        className="absolute inset-x-0 bottom-0 h-1/2"
        initial={{ y: '100%' }}
        animate={{ y: curtainsClosed ? '0%' : '100%' }}
        transition={{ duration: 0.6, ease: [0.65, 0, 0.35, 1] }}
        style={{
          background: 'linear-gradient(0deg, #4a0d12 0%, #7a1522 45%, #5c0f18 100%)',
          boxShadow: '0 -20px 60px rgba(0,0,0,0.6)'
        }}
      >
        <div
          className="absolute inset-0 opacity-40"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 14px, rgba(255,255,255,0.06) 14px, rgba(255,255,255,0.06) 28px)' }}
        />
        <div className="absolute top-0 inset-x-0 h-2" style={{ background: 'linear-gradient(90deg, #d4af37, #f5e08a, #d4af37)' }} />
      </motion.div>

      {/* Shuffle-reveal text, centered over the curtain seam */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center px-4"
        animate={{ opacity: textVisible ? 1 : 0, scale: textVisible ? 1 : 0.92 }}
        transition={{ duration: 0.35 }}
      >
        <div className="text-center">
          <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1">
            {words.map(({ letters }, wordIdx) => (
              <div key={wordIdx} className="flex" style={{ textShadow: '0 0 30px rgba(251,191,36,0.6)' }}>
                {letters.map(({ char, lockAtMs }, charIdx) => (
                  <span key={charIdx} className="text-4xl sm:text-6xl md:text-7xl font-black tracking-widest text-amber-300 uppercase">
                    <ShuffleLetter char={char} active={phase === 'shuffle'} lockAtMs={lockAtMs} />
                  </span>
                ))}
              </div>
            ))}
          </div>
          <motion.p
            className="mt-4 text-sm sm:text-base font-bold uppercase tracking-[0.3em] text-white/60"
            animate={{ opacity: textVisible ? 1 : 0 }}
            transition={{ delay: 1.2, duration: 0.5 }}
          >
            Bidding is now open
          </motion.p>
        </div>
      </motion.div>
    </div>
  )
}
