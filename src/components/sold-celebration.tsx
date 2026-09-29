"use client"

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

interface SoldCelebrationProps {
  show: boolean
  playerName: string
  photoUrl?: string | null
  amount: number
  teamName?: string
  bidderName?: string
  onDismiss: () => void
}

const CELEBRATE_MS = 3200
const REDUCED_MS = 1200
const CONFETTI_COLORS = ['#f3c969', '#ff5d8f', '#5b8cff', '#3fd18b', '#ffffff', '#b77cff', '#ff8a3d']

interface ConfettiPiece {
  x: number; y: number; vx: number; vy: number
  w: number; h: number; rot: number; vr: number; color: string
}

// Two side bursts of falling, tumbling rectangles - same physics as the
// offline auction tool's celebration (squady_turbo.html), ported to a
// React-owned canvas instead of a manually appended DOM node.
function launchConfetti(canvas: HTMLCanvasElement, durationMs: number): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const dpr = window.devicePixelRatio || 1
  const W = (canvas.width = window.innerWidth * dpr)
  const H = (canvas.height = window.innerHeight * dpr)
  const pieces: ConfettiPiece[] = []
  const burst = (x: number, dir: number) => {
    for (let i = 0; i < 90; i++) {
      const angle = -Math.PI / 2 + dir * (Math.random() * 0.9) + (Math.random() - 0.5) * 0.5
      const speed = (9 + Math.random() * 11) * dpr
      pieces.push({
        x, y: H * 0.95, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 10) * dpr,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      })
    }
  }
  burst(W * 0.12, 1)
  burst(W * 0.88, -1)
  const start = performance.now()
  let raf = 0
  let cancelled = false
  const frame = (now: number) => {
    if (cancelled) return
    const t = now - start
    ctx.clearRect(0, 0, W, H)
    pieces.forEach(pc => {
      pc.vy += 0.32 * dpr
      pc.vx *= 0.99
      pc.vy *= 0.99
      pc.x += pc.vx
      pc.y += pc.vy
      pc.rot += pc.vr
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - t / durationMs)
      ctx.translate(pc.x, pc.y)
      ctx.rotate(pc.rot)
      ctx.fillStyle = pc.color
      ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h * Math.abs(Math.cos(pc.rot * 2)))
      ctx.restore()
    })
    if (t < durationMs) raf = requestAnimationFrame(frame)
    else ctx.clearRect(0, 0, W, H)
  }
  raf = requestAnimationFrame(frame)
  return () => {
    cancelled = true
    cancelAnimationFrame(raf)
  }
}

// Full-screen "SOLD!" takeover with a confetti burst, matching the offline
// auction tool's celebration - shown for a few seconds after every sale,
// dismissible early by click or Escape/Enter/Space.
export function SoldCelebration({ show, playerName, photoUrl, amount, teamName, bidderName, onDismiss }: SoldCelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!show) return
    const duration = reducedMotion ? REDUCED_MS : CELEBRATE_MS
    const stopConfetti = !reducedMotion && canvasRef.current ? launchConfetti(canvasRef.current, duration) : undefined
    const timer = setTimeout(onDismiss, duration)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
      stopConfetti?.()
    }
    // onDismiss is a fresh closure each render - only show/reducedMotion should restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, reducedMotion])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 cursor-pointer"
          onClick={onDismiss}
          role="dialog"
          aria-live="assertive"
        >
          <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none" />
          <motion.div
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="relative w-full max-w-sm rounded-3xl bg-[#0a0d12] border border-white/10 px-6 py-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
          >
            {photoUrl && (
              <div className="w-28 h-28 mx-auto mb-4 rounded-2xl overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt={playerName} className="w-full h-full object-cover" />
              </div>
            )}
            <motion.div
              initial={{ scale: 2.4, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: -4, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 14 }}
              className="text-6xl font-black uppercase tracking-wide text-amber-400"
            >
              SOLD!
            </motion.div>
            <div className="mt-2 text-2xl font-black text-white uppercase tracking-tight truncate">{playerName}</div>
            <div className="mt-1.5 text-3xl font-black text-amber-400 tabular-nums">₹{amount.toLocaleString('en-IN')}</div>
            {(teamName || bidderName) && (
              <div className="mt-2 text-sm text-gray-400">
                to <span className="font-bold text-white">{[teamName, bidderName].filter(Boolean).join(' · ')}</span>
              </div>
            )}
            <div className="mt-4 text-[11px] text-gray-500">Click anywhere to continue</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
