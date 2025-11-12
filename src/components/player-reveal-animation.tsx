'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

interface PlayerRevealAnimationProps {
  allPlayerNames: string[]
  finalPlayerName: string
  onComplete: () => void
  duration?: number // Duration in milliseconds (default 5000ms)
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function PlayerRevealAnimation({ 
  allPlayerNames, 
  finalPlayerName, 
  onComplete,
  duration = 5000 
}: PlayerRevealAnimationProps) {
  const [displayText, setDisplayText] = useState<string[]>([])
  const [isRevealing, setIsRevealing] = useState(false)
  const animationFrameRef = useRef<number | null>(null)
  const finalTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const onCompleteRef = useRef(onComplete)
  const startTimeRef = useRef<number>(0)
  const lastUpdateRef = useRef<number>(0)
  const phaseRef = useRef<'fast' | 'slow' | 'reveal'>('fast')
  const finalNameRef = useRef<string>(finalPlayerName)

  // Keep onComplete and finalName refs updated
  useEffect(() => {
    onCompleteRef.current = onComplete
    finalNameRef.current = finalPlayerName
  }, [onComplete, finalPlayerName])

  // Generate random letter for each position
  const getRandomLetter = useCallback(() => {
    return ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }, [])

  // Initialize display text with random letters matching final name length
  useEffect(() => {
    const nameLength = finalNameRef.current.length
    const initialLetters = Array.from({ length: nameLength }, () => getRandomLetter())
    setDisplayText(initialLetters)
  }, [getRandomLetter])

  // Optimized animation loop using requestAnimationFrame
  const animate = useCallback(() => {
    const now = Date.now()
    const elapsed = now - startTimeRef.current
    const remaining = duration - elapsed

    if (remaining <= 0) {
      // Final reveal - show actual player name
      phaseRef.current = 'reveal'
      setIsRevealing(true)
      const finalName = finalNameRef.current
      setDisplayText(finalName.split(''))
      
      finalTimeoutRef.current = setTimeout(() => {
        onCompleteRef.current()
      }, 1500)
      return
    }

    if (remaining <= 1500 && phaseRef.current === 'fast') {
      // Switch to slow phase
      phaseRef.current = 'slow'
    }

    // Update letters based on phase
    const timeSinceLastUpdate = now - lastUpdateRef.current
    const updateInterval = phaseRef.current === 'fast' ? 100 : 200

    if (timeSinceLastUpdate >= updateInterval) {
      const nameLength = finalNameRef.current.length
      const newLetters = Array.from({ length: nameLength }, () => getRandomLetter())
      setDisplayText(newLetters)
      lastUpdateRef.current = now
    }

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(animate)
  }, [duration, getRandomLetter])

  useEffect(() => {
    // Clear any existing animations
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (finalTimeoutRef.current) {
      clearTimeout(finalTimeoutRef.current)
      finalTimeoutRef.current = null
    }
    
    const now = Date.now()
    startTimeRef.current = now
    lastUpdateRef.current = now
    phaseRef.current = 'fast'

    // Initialize with random letters
    const nameLength = finalNameRef.current.length
    const initialLetters = Array.from({ length: nameLength }, () => getRandomLetter())
    setDisplayText(initialLetters)

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      if (finalTimeoutRef.current) {
        clearTimeout(finalTimeoutRef.current)
        finalTimeoutRef.current = null
      }
    }
  }, [animate, getRandomLetter])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md rounded-xl overflow-hidden"
      style={{ willChange: 'transform, opacity' }}
    >
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Optimized background glow */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute inset-0 bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500 rounded-full blur-2xl"
          style={{ willChange: 'transform, opacity' }}
        />

        {/* Card container */}
        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-xl p-6 sm:p-8 shadow-2xl border border-yellow-500/30 max-w-[90%] sm:max-w-md">
          {/* Sparkles decoration */}
          <div className="absolute top-4 right-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              style={{ willChange: 'transform' }}
            >
              <Sparkles className="h-6 w-6 text-yellow-400" />
            </motion.div>
          </div>

          {/* "Next Player" text */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-center mb-3 sm:mb-4"
          >
            <h3 className="text-xs sm:text-sm font-semibold text-yellow-400 uppercase tracking-wider">
              {isRevealing ? `🎉 ${finalPlayerName} 🎉` : 'Next Player Coming...'}
            </h3>
          </motion.div>

          {/* Letter shuffling display - timer style */}
          <div className="relative h-20 sm:h-28 flex items-center justify-center overflow-hidden">
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              {displayText.map((letter, index) => (
                <AnimatePresence key={`${letter}-${index}`} mode="wait">
                  <motion.div
                    key={`${letter}-${index}-${Date.now()}`}
                    initial={{ 
                      opacity: 0, 
                      y: isRevealing ? -30 : 20,
                      scale: isRevealing ? 0.5 : 0.8
                    }}
                    animate={{ 
                      opacity: 1, 
                      y: 0,
                      scale: isRevealing ? 1.1 : 1
                    }}
                    exit={{ 
                      opacity: 0, 
                      y: isRevealing ? 30 : -20,
                      scale: isRevealing ? 1.3 : 0.8
                    }}
                    transition={{ 
                      duration: isRevealing ? 0.6 : 0.1,
                      ease: isRevealing ? "easeOut" : "linear"
                    }}
                    className={`inline-block ${
                      isRevealing 
                        ? 'text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 drop-shadow-2xl' 
                        : 'text-white font-extrabold drop-shadow-lg'
                    }`}
                    style={{ 
                      willChange: 'transform, opacity',
                      fontFamily: 'monospace'
                    }}
                  >
                    <span className={`text-3xl sm:text-5xl font-black ${
                      isRevealing ? '' : 'font-mono'
                    }`}>
                      {letter}
                    </span>
                  </motion.div>
                </AnimatePresence>
              ))}
            </div>
          </div>

          {/* Loading dots (only when cycling) */}
          {!isRevealing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex justify-center gap-2 mt-6"
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{
                    scale: [1, 1.5, 1],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut"
                  }}
                  className="w-2 h-2 bg-yellow-400 rounded-full"
                  style={{ willChange: 'transform, opacity' }}
                />
              ))}
            </motion.div>
          )}

          {/* Simplified confetti effect on reveal */}
          {isRevealing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 pointer-events-none overflow-hidden"
            >
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ 
                    x: '50%', 
                    y: '50%',
                    scale: 0,
                    rotate: 0
                  }}
                  animate={{
                    x: `${50 + (Math.random() - 0.5) * 200}%`,
                    y: `${50 + (Math.random() - 0.5) * 200}%`,
                    scale: [0, 1, 0],
                    rotate: Math.random() * 360,
                    opacity: [0, 1, 0]
                  }}
                  transition={{
                    duration: 1.2,
                    ease: "easeOut",
                    delay: i * 0.05
                  }}
                  className="absolute w-3 h-3 rounded-full"
                  style={{
                    backgroundColor: ['#fbbf24', '#f97316', '#ef4444', '#8b5cf6'][Math.floor(Math.random() * 4)],
                    willChange: 'transform, opacity'
                  }}
                />
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
