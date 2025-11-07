'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

interface PlayerRevealAnimationProps {
  allPlayerNames: string[]
  finalPlayerName: string
  onComplete: () => void
  duration?: number // Duration in milliseconds (default 5000ms)
}

export function PlayerRevealAnimation({ 
  allPlayerNames, 
  finalPlayerName, 
  onComplete,
  duration = 5000 
}: PlayerRevealAnimationProps) {
  const [currentName, setCurrentName] = useState('')
  const [isRevealing, setIsRevealing] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const slowIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const finalTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const onCompleteRef = useRef(onComplete)
  const currentNameRef = useRef('')

  // Keep onComplete ref updated
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    console.log('🎭 PlayerRevealAnimation mounted!', { 
      allPlayerNamesCount: allPlayerNames.length, 
      finalPlayerName,
      duration 
    })
    
    // Clear any existing intervals/timeouts
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (slowIntervalRef.current) clearInterval(slowIntervalRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (finalTimeoutRef.current) clearTimeout(finalTimeoutRef.current)
    
    if (allPlayerNames.length === 0) {
      console.log('⚠️ No player names available, completing immediately')
      onCompleteRef.current()
      return
    }

    // Filter out the final player to avoid showing it early
    const otherNames = allPlayerNames.filter(name => name !== finalPlayerName)
    
    console.log('🎭 Filtered names for animation:', {
      totalNames: allPlayerNames.length,
      otherNamesCount: otherNames.length,
      finalPlayerName,
      otherNames: otherNames.slice(0, 5)
    })
    
    // If no other names available, just show the final name
    if (otherNames.length === 0) {
      console.log('⚠️ No other names available, showing final name immediately')
      currentNameRef.current = finalPlayerName
      setCurrentName(finalPlayerName)
      setIsRevealing(true)
      finalTimeoutRef.current = setTimeout(() => {
        onCompleteRef.current()
      }, 2000)
      return
    }

    // Start with a random name immediately
    const initialName = otherNames[Math.floor(Math.random() * otherNames.length)]
    console.log('🎭 Starting with initial name:', initialName)
    currentNameRef.current = initialName
    setCurrentName(initialName)

    // Phase 1: Fast random cycling (first 3 seconds)
    const fastCycleSpeed = 150 // Change name every 150ms
    console.log('🎭 Starting fast cycle (150ms intervals)')
    intervalRef.current = setInterval(() => {
      // Ensure we pick a different name than the current one
      let randomName = otherNames[Math.floor(Math.random() * otherNames.length)]
      // If we picked the same name and there are other options, try again
      if (randomName === currentNameRef.current && otherNames.length > 1) {
        const filtered = otherNames.filter(n => n !== currentNameRef.current)
        if (filtered.length > 0) {
          randomName = filtered[Math.floor(Math.random() * filtered.length)]
        }
      }
      if (randomName !== currentNameRef.current) {
        console.log('🔄 Fast cycle name change:', randomName, '(was:', currentNameRef.current + ')')
        currentNameRef.current = randomName
        setCurrentName(randomName)
      }
    }, fastCycleSpeed)

    // Phase 2: Slow down (last 1.5 seconds)
    timeoutRef.current = setTimeout(() => {
      console.log('🎭 Switching to slow cycle (300ms intervals)')
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      
      // Slow cycling
      const slowCycleSpeed = 300
      slowIntervalRef.current = setInterval(() => {
        let randomName = otherNames[Math.floor(Math.random() * otherNames.length)]
        // If we picked the same name and there are other options, try again
        if (randomName === currentNameRef.current && otherNames.length > 1) {
          const filtered = otherNames.filter(n => n !== currentNameRef.current)
          if (filtered.length > 0) {
            randomName = filtered[Math.floor(Math.random() * filtered.length)]
          }
        }
        if (randomName !== currentNameRef.current) {
          console.log('🔄 Slow cycle name change:', randomName, '(was:', currentNameRef.current + ')')
          currentNameRef.current = randomName
          setCurrentName(randomName)
        }
      }, slowCycleSpeed)
    }, duration - 1500)

    // Phase 3: Final reveal
    finalTimeoutRef.current = setTimeout(() => {
      console.log('🎭 Final reveal:', finalPlayerName)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (slowIntervalRef.current) {
        clearInterval(slowIntervalRef.current)
        slowIntervalRef.current = null
      }
      setIsRevealing(true)
      currentNameRef.current = finalPlayerName
      setCurrentName(finalPlayerName)
      
      // Complete after showing final name for 1.5 seconds
      setTimeout(() => {
        console.log('✅ Animation complete, calling onComplete')
        onCompleteRef.current()
      }, 1500)
    }, duration)

    return () => {
      console.log('🧹 Cleaning up animation intervals/timeouts')
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (slowIntervalRef.current) {
        clearInterval(slowIntervalRef.current)
        slowIntervalRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (finalTimeoutRef.current) {
        clearTimeout(finalTimeoutRef.current)
        finalTimeoutRef.current = null
      }
    }
  }, [allPlayerNames, finalPlayerName, duration]) // Removed onComplete from deps to prevent re-running

  console.log('🎭 PlayerRevealAnimation RENDERING', {
    allPlayerNamesCount: allPlayerNames.length,
    finalPlayerName,
    currentName,
    isRevealing
  })

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md rounded-xl overflow-hidden"
    >
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Animated background glow */}
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
        />

        {/* Card container - smaller and centered */}
        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-xl p-6 sm:p-8 shadow-2xl border border-yellow-500/30 max-w-[90%] sm:max-w-md">
          {/* Sparkles decoration */}
          <div className="absolute top-4 right-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              <Sparkles className="h-6 w-6 text-yellow-400" />
            </motion.div>
          </div>

          {/* "Next Player" text */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-3 sm:mb-4"
          >
            <h3 className="text-xs sm:text-sm font-semibold text-yellow-400 uppercase tracking-wider">
              {isRevealing ? '🎉 Introducing 🎉' : 'Next Player Coming...'}
            </h3>
          </motion.div>

          {/* Player name cycling animation */}
          <div className="relative h-20 sm:h-28 flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentName}
                initial={{ 
                  opacity: 0, 
                  y: isRevealing ? -30 : 15,
                  scale: isRevealing ? 0.5 : 0.9
                }}
                animate={{ 
                  opacity: 1, 
                  y: 0,
                  scale: isRevealing ? 1.05 : 1
                }}
                exit={{ 
                  opacity: 0, 
                  y: isRevealing ? 30 : -15,
                  scale: isRevealing ? 1.3 : 0.9
                }}
                transition={{ 
                  duration: isRevealing ? 0.8 : 0.15,
                  ease: isRevealing ? "easeOut" : "linear"
                }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <h1 className={`text-2xl sm:text-4xl font-black text-center px-2 ${
                  isRevealing 
                    ? 'text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 drop-shadow-2xl' 
                    : 'text-white font-extrabold drop-shadow-lg'
                }`}>
                  {currentName || '...'}
                </h1>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Loading dots (only when cycling) */}
          {!isRevealing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
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
                  }}
                  className="w-2 h-2 bg-yellow-400 rounded-full"
                />
              ))}
            </motion.div>
          )}

          {/* Confetti effect on reveal */}
          {isRevealing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 pointer-events-none"
            >
              {[...Array(20)].map((_, i) => (
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
                    duration: 1.5,
                    ease: "easeOut"
                  }}
                  className="absolute w-3 h-3 rounded-full"
                  style={{
                    backgroundColor: ['#fbbf24', '#f97316', '#ef4444', '#8b5cf6'][Math.floor(Math.random() * 4)]
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

