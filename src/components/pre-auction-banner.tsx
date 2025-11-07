'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Sparkles } from 'lucide-react'
import Link from 'next/link'

interface PreAuctionBannerProps {
  scheduledStartDate: Date | string | null
  auctionName: string
  onAuctionStart?: () => void
}

export function PreAuctionBanner({ scheduledStartDate, auctionName, onAuctionStart }: PreAuctionBannerProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number
    hours: number
    minutes: number
    seconds: number
  } | null>(null)
  const [hasStarted, setHasStarted] = useState(false)

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
        // Auction has started
        setHasStarted(true)
        setTimeLeft(null)
        if (onAuctionStart) {
          onAuctionStart()
        }
        return
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24))
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((difference % (1000 * 60)) / 1000)

      setTimeLeft({ days, hours, minutes, seconds })
      setHasStarted(false)
    }

    // Update immediately
    updateTimer()

    // Update every second
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [scheduledStartDate, onAuctionStart])

  // Don't show banner if auction has started or no scheduled date
  if (hasStarted || !scheduledStartDate || !timeLeft) {
    return null
  }

  const formatNumber = (num: number) => String(num).padStart(2, '0')

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="fixed top-0 left-0 right-0 z-[9998] bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 shadow-lg"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Left: Auction Info */}
            <div className="flex items-center gap-3 text-white">
              <motion.div
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              >
                <Sparkles className="w-6 h-6 text-yellow-300" />
              </motion.div>
              <div>
                <h2 className="text-lg md:text-xl font-bold">{auctionName}</h2>
                <p className="text-sm md:text-base text-blue-100">Starting Soon</p>
              </div>
            </div>

            {/* Center: Countdown Timer */}
            <div className="flex items-center gap-2 md:gap-4">
              <Clock className="w-5 h-5 md:w-6 md:h-6 text-yellow-300" />
              <div className="flex items-center gap-2 md:gap-3">
                {timeLeft.days > 0 && (
                  <motion.div
                    className="bg-white/20 backdrop-blur-sm rounded-lg px-3 md:px-4 py-2 text-center min-w-[60px] md:min-w-[70px]"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    <div className="text-2xl md:text-3xl font-bold text-white">{formatNumber(timeLeft.days)}</div>
                    <div className="text-xs text-blue-100">Days</div>
                  </motion.div>
                )}
                <motion.div
                  className="bg-white/20 backdrop-blur-sm rounded-lg px-3 md:px-4 py-2 text-center min-w-[60px] md:min-w-[70px]"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                >
                  <div className="text-2xl md:text-3xl font-bold text-white">{formatNumber(timeLeft.hours)}</div>
                  <div className="text-xs text-blue-100">Hours</div>
                </motion.div>
                <motion.div
                  className="bg-white/20 backdrop-blur-sm rounded-lg px-3 md:px-4 py-2 text-center min-w-[60px] md:min-w-[70px]"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                >
                  <div className="text-2xl md:text-3xl font-bold text-white">{formatNumber(timeLeft.minutes)}</div>
                  <div className="text-xs text-blue-100">Mins</div>
                </motion.div>
                <motion.div
                  className="bg-white/20 backdrop-blur-sm rounded-lg px-3 md:px-4 py-2 text-center min-w-[60px] md:min-w-[70px]"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.6 }}
                >
                  <div className="text-2xl md:text-3xl font-bold text-white">{formatNumber(timeLeft.seconds)}</div>
                  <div className="text-xs text-blue-100">Secs</div>
                </motion.div>
              </div>
            </div>

            {/* Right: Branding */}
            <div className="flex items-center gap-3">
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/30 bg-white/10 backdrop-blur-sm text-white text-xs md:text-sm font-semibold hover:bg-white/20 transition-colors shadow-sm"
              >
                <span>Powered by</span>
                <span className="font-bold">Professio AI</span>
              </a>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

