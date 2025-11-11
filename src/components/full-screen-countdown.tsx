'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Clock, Sparkles } from 'lucide-react'
import Image from 'next/image'

interface FullScreenCountdownProps {
  scheduledStartDate: Date | string
  auctionName: string
  onCountdownComplete?: () => void
}

// Team images array
const teamImages = [
  '/blasters.jpeg',
  '/eagles.jpeg',
  '/falcon.jpg',
  '/jersey.jpg',
  '/mavericks.jpg',
  '/spartans.jpeg',
  '/superkings.jpeg',
  '/surmas.jpeg',
  '/titans.jpg',
  '/warriors.jpeg',
  '/invincibles.jpeg',
  '/yoddhas.jpeg',
]

export function FullScreenCountdown({ scheduledStartDate, auctionName, onCountdownComplete }: FullScreenCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number
    hours: number
    minutes: number
    seconds: number
  } | null>(null)

  // Generate random positions and animations for team images
  const teamImageAnimations = useMemo(() => {
    return teamImages.map((src, index) => {
      // Random starting positions
      const startX = Math.random() * 100 // 0-100%
      const startY = Math.random() * 100 // 0-100%
      
      // Random end positions (within viewport)
      const endX = Math.random() * 100
      const endY = Math.random() * 100
      
      // Random sizes (between 80px and 200px)
      const size = 80 + Math.random() * 120
      
      // Random animation duration (between 20s and 40s for slow movement)
      const duration = 20 + Math.random() * 20
      
      // Random delay
      const delay = Math.random() * 5
      
      return {
        src,
        startX,
        startY,
        endX,
        endY,
        size,
        duration,
        delay,
        index,
      }
    })
  }, [])

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

  const formatNumber = (num: number) => String(num).padStart(2, '0')

  const CountdownCard = ({ 
    value, 
    label, 
    isSeconds = false 
  }: { 
    value: number
    label: string
    isSeconds?: boolean
  }) => (
    <div className="relative flex-shrink-0" style={{ overflow: 'visible' }}>
      {/* Glowing background effect - static */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/30 via-blue-500/20 to-purple-600/30 rounded-xl blur-xl" style={{ overflow: 'visible' }} />
      
      {/* Border glow ring - static */}
      <div
        className="absolute -inset-1 rounded-xl opacity-60"
        style={{
          background: 'linear-gradient(45deg, #00f0ff, #8b5cf6, #ec4899, #f59e0b, #00f0ff)',
          backgroundSize: '300% 300%',
          borderRadius: '0.875rem',
          filter: 'blur(10px)',
        }}
      />
      
      {/* Main card - static */}
      <div
        className="relative bg-gradient-to-br from-cyan-500/20 via-blue-600/30 to-purple-700/20 backdrop-blur-xl rounded-xl py-4 px-5 sm:py-5 sm:px-6 md:py-6 md:px-7 lg:py-7 lg:px-8 xl:py-8 xl:px-10 text-center w-[100px] sm:w-[110px] md:w-[120px] lg:w-[140px] xl:w-[160px] 2xl:w-[180px] flex-shrink-0 border border-cyan-400/50 min-h-[100px] sm:min-h-[115px] md:min-h-[125px] lg:min-h-[145px] xl:min-h-[165px] 2xl:min-h-[185px] flex flex-col items-center justify-center"
        style={{
          boxShadow: isSeconds 
            ? '0 0 30px rgba(0,240,255,0.4), 0 0 60px rgba(139,92,246,0.3), 0 0 90px rgba(236,72,153,0.2)'
            : '0 0 20px rgba(0,240,255,0.3), 0 0 40px rgba(139,92,246,0.2)',
          overflow: 'visible',
        }}
      >
        {/* Number with neon glow effect - ONLY ANIMATED ELEMENT */}
        <div className="relative w-full flex items-center justify-center mb-2 sm:mb-2.5 md:mb-3" style={{ overflow: 'visible', minHeight: '2.5em', padding: '0 4px' }}>
          <motion.div
            className={`relative text-2xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl 2xl:text-8xl font-bold bg-gradient-to-br from-cyan-200 via-white to-purple-200 bg-clip-text text-transparent leading-none ${
              isSeconds ? 'animate-pulse-glow' : ''
            }`}
            key={`${value}-${label}`}
            initial={{ scale: 0.9, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              filter: isSeconds ? 'drop-shadow(0 0 15px rgba(0,240,255,0.9)) drop-shadow(0 0 30px rgba(139,92,246,0.6))' : 'drop-shadow(0 0 10px rgba(0,240,255,0.6)) drop-shadow(0 0 20px rgba(139,92,246,0.4))',
              lineHeight: '1',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'visible',
              padding: '0 2px',
            }}
          >
            {formatNumber(value)}
          </motion.div>
        </div>
        
        {/* Label - static with auto-scaling */}
        <div 
          className="relative w-full text-cyan-200 font-medium tracking-tight uppercase mt-1 sm:mt-1.5 text-center px-1"
          style={{ 
            fontSize: label.length > 6 
              ? 'clamp(6px, 1.5vw, 12px)' 
              : 'clamp(7px, 1.8vw, 14px)',
            lineHeight: '1.3',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'clip',
          }}
        >
          {label}
        </div>
        
        {/* Corner accents - static */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-400/70 rounded-tl-xl" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-purple-400/70 rounded-tr-xl" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-blue-400/70 rounded-bl-xl" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-400/70 rounded-br-xl" />
      </div>
    </div>
  )

  return (
    <>
      {/* Animated Team Images Background - Full Viewport */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        {teamImageAnimations.map((anim, idx) => (
          <motion.div
            key={idx}
            className="absolute"
            initial={{
              left: `${anim.startX}%`,
              top: `${anim.startY}%`,
              opacity: 0.08, // Much less visible (92% transparency)
            }}
            animate={{
              left: [`${anim.startX}%`, `${anim.endX}%`, `${anim.startX}%`],
              top: [`${anim.startY}%`, `${anim.endY}%`, `${anim.startY}%`],
              opacity: [0.08, 0.05, 0.08], // Slight opacity variation
            }}
            transition={{
              duration: anim.duration,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: anim.delay,
            }}
            style={{
              width: `${anim.size}px`,
              height: `${anim.size}px`,
              transform: 'translate(-50%, -50%)', // Center the image on the position
            }}
          >
            <Image
              src={anim.src}
              alt={`Team ${idx + 1}`}
              width={anim.size}
              height={anim.size}
              className="w-full h-full object-contain rounded-lg"
              style={{
                filter: 'blur(3px)',
              }}
              unoptimized
            />
          </motion.div>
        ))}
      </div>

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

            {/* Countdown Cards - Single Line on All Screens */}
            <div className="relative z-10 flex flex-row items-center justify-center gap-2 sm:gap-3 md:gap-4 lg:gap-5 xl:gap-6 w-full max-w-5xl flex-nowrap px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16" style={{ overflowY: 'visible', overflowX: 'visible' }}>
              {timeLeft.days > 0 && (
                <>
                  <CountdownCard 
                    value={timeLeft.days} 
                    label="Days" 
                  />
                  {/* Separator */}
                  <div className="h-12 sm:h-16 md:h-20 w-px bg-gradient-to-b from-transparent via-cyan-400/50 to-transparent flex-shrink-0" />
                </>
              )}
              <CountdownCard 
                value={timeLeft.hours} 
                label="Hours" 
              />
              {/* Separator */}
              <div className="h-12 sm:h-16 md:h-20 w-px bg-gradient-to-b from-transparent via-purple-400/50 to-transparent flex-shrink-0" />
              <CountdownCard 
                value={timeLeft.minutes} 
                label="Minutes" 
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}

