'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Clock, Sparkles } from 'lucide-react'

interface FullScreenCountdownProps {
  scheduledStartDate: Date | string
  auctionName: string
  onCountdownComplete?: () => void
}

function formatNumber(num: number) {
  return String(num).padStart(2, '0')
}

function CountdownCard({
  value,
  label,
  isSeconds = false
}: {
  value: number
  label: string
  isSeconds?: boolean
}) {
  return (
    <div
      className="relative flex-shrink-0 w-[76px] h-[86px] sm:w-[100px] sm:h-[112px] md:w-[120px] md:h-[132px] lg:w-[132px] lg:h-[150px] rounded-2xl flex flex-col items-center justify-center"
      style={{
        background: isSeconds
          ? 'linear-gradient(160deg, rgba(239,68,68,0.18), rgba(251,191,36,0.12))'
          : 'linear-gradient(160deg, rgba(20,184,166,0.16), rgba(251,191,36,0.1))',
        border: isSeconds ? '1px solid rgba(239,68,68,0.55)' : '1px solid rgba(251,191,36,0.4)',
        boxShadow: isSeconds ? '0 0 46px rgba(239,68,68,0.3)' : '0 0 40px rgba(251,191,36,0.18)',
      }}
    >
      {/* Corner brackets - scoreboard readout accent */}
      <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 rounded-tl-sm" style={{ borderColor: '#fbbf24' }} />
      <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 rounded-br-sm" style={{ borderColor: isSeconds ? '#ef4444' : '#14b8a6' }} />
      {isSeconds && (
        <div className="absolute inset-[-1px] rounded-2xl border border-red-500/70 opacity-70 pointer-events-none" />
      )}

      <motion.div
        className="tabular-nums font-bold text-white leading-none text-2xl sm:text-4xl md:text-5xl lg:text-6xl"
        key={`${value}-${label}`}
        initial={{ scale: 0.9, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{
          filter: isSeconds
            ? 'drop-shadow(0 0 15px rgba(239,68,68,0.7))'
            : 'drop-shadow(0 0 10px rgba(0,240,255,0.6)) drop-shadow(0 0 20px rgba(139,92,246,0.4))',
        }}
      >
        {formatNumber(value)}
      </motion.div>

      <div
        className="mt-1.5 sm:mt-2 md:mt-2.5 text-[8px] sm:text-[10px] md:text-xs font-bold uppercase tracking-wider text-center"
        style={{ color: isSeconds ? '#fca5a5' : '#fbbf24' }}
      >
        {label}
      </div>
    </div>
  )
}

export function FullScreenCountdown({ scheduledStartDate, auctionName, onCountdownComplete }: FullScreenCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number
    hours: number
    minutes: number
    seconds: number
  } | null>(null)

  useEffect(() => {
    if (!scheduledStartDate) {
      setTimeLeft(null)
      return
    }

    const updateTimer = () => {
      const now = new Date().getTime()
      const startDate = new Date(scheduledStartDate).getTime()
      const difference = startDate - now

      if (difference <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
        // Call callback instead of reloading page
        if (onCountdownComplete) {
          onCountdownComplete()
        }
        return
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24))
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((difference % (1000 * 60)) / 1000)

      setTimeLeft({ days, hours, minutes, seconds })
    }

    // Update immediately
    updateTimer()

    // Update every second
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [scheduledStartDate])

  if (!timeLeft) {
    return null
  }

  // Check if timer has reached zero
  const isTimerComplete = timeLeft.days === 0 && timeLeft.hours === 0 && timeLeft.minutes === 0 && timeLeft.seconds === 0

  return (
    <div className="relative flex flex-col items-center justify-center gap-4 sm:gap-6 md:gap-8 w-full px-2 min-h-[200px] z-10">
      {isTimerComplete ? (
        /* Show "Starting Soon" message when timer reaches 0 */
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center gap-4 sm:gap-6"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 text-yellow-400 animate-pulse" />
            <h2
              className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold text-center"
              style={{
                background: 'linear-gradient(90deg, #67e8f9, #fbbf24, #a78bfa, #67e8f9)',
                backgroundSize: '200% 100%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'gradient-shift 3s ease infinite',
              }}
            >
              Starting Soon
            </h2>
            <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 text-yellow-400 animate-pulse" />
          </div>
          <p className="text-base sm:text-lg md:text-xl lg:text-2xl text-blue-200 text-center animate-pulse">
            Please stay tuned...
          </p>
        </motion.div>
      ) : (
        <>
          {/* Header - static */}
          <div className="relative z-10 flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 lg:w-10 lg:h-10 flex-shrink-0 text-cyan-400 drop-shadow-[0_0_10px_rgba(0,240,255,0.8)]" />
            <span
              className="text-sm sm:text-base md:text-xl lg:text-2xl font-semibold"
              style={{
                background: 'linear-gradient(90deg, #67e8f9, #fbbf24, #a78bfa, #67e8f9)',
                backgroundSize: '200% 100%',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Auction Starts In
            </span>
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-yellow-400" />
          </div>

          {/* Scoreboard countdown - Days (when present), Hours, Minutes, Seconds - every
              unit ticks, so the clock never sits still for up to 59s the way a
              minutes-only display would. */}
          <div className="relative z-10 flex flex-row items-center justify-center gap-2 sm:gap-3 md:gap-4 lg:gap-5 w-full max-w-4xl flex-nowrap px-2 sm:px-6 md:px-8">
            {timeLeft.days > 0 && (
              <>
                <CountdownCard value={timeLeft.days} label="Days" />
                <div className="h-10 sm:h-14 md:h-16 w-px bg-white/15 flex-shrink-0" />
              </>
            )}
            <CountdownCard value={timeLeft.hours} label="Hours" />
            <div className="h-10 sm:h-14 md:h-16 w-px bg-white/15 flex-shrink-0" />
            <CountdownCard value={timeLeft.minutes} label="Minutes" />
            <div className="h-10 sm:h-14 md:h-16 w-px bg-white/15 flex-shrink-0" />
            <CountdownCard value={timeLeft.seconds} label="Seconds" isSeconds />
          </div>
        </>
      )}
    </div>
  )
}
