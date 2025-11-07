'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Zap, TrendingUp } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface GoingLiveBannerProps {
  show: boolean
  onComplete?: () => void
}

export function GoingLiveBanner({ show, onComplete }: GoingLiveBannerProps) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (show) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      
      // Call onComplete after 4 seconds
      timeoutRef.current = setTimeout(() => {
        if (onComplete) {
          onComplete()
        }
        timeoutRef.current = null
      }, 4000)
    }

    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [show, onComplete])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center"
        >
          <div className="text-center space-y-8 px-4">
            {/* Animated Sparkles */}
            <motion.div
              className="flex justify-center gap-4 mb-8"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            >
              <motion.div
                animate={{
                  rotate: [0, 360],
                  scale: [1, 1.2, 1]
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
              >
                <Sparkles className="w-16 h-16 text-yellow-400" />
              </motion.div>
              <motion.div
                animate={{
                  rotate: [360, 0],
                  scale: [1, 1.2, 1]
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: 0.3
                }}
              >
                <Zap className="w-16 h-16 text-blue-400" />
              </motion.div>
              <motion.div
                animate={{
                  rotate: [0, 360],
                  scale: [1, 1.2, 1]
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: 0.6
                }}
              >
                <TrendingUp className="w-16 h-16 text-pink-400" />
              </motion.div>
            </motion.div>

            {/* Main Text */}
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              <h1 className="text-6xl md:text-8xl font-bold text-white mb-4 tracking-tight">
                <motion.span
                  animate={{
                    textShadow: [
                      '0 0 20px rgba(255,255,255,0.5)',
                      '0 0 40px rgba(255,255,255,0.8)',
                      '0 0 20px rgba(255,255,255,0.5)'
                    ]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut'
                  }}
                >
                  AUCTION
                </motion.span>
              </h1>
              <motion.h2
                className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-pink-400 to-blue-400 mb-6"
                animate={{
                  backgroundPosition: ['0%', '100%', '0%']
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'linear'
                }}
                style={{
                  backgroundSize: '200% 200%'
                }}
              >
                GOING LIVE SOON
              </motion.h2>
            </motion.div>

            {/* Pulsing Dot */}
            <motion.div
              className="flex justify-center mt-8"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.6 }}
            >
              <motion.div
                className="w-4 h-4 bg-yellow-400 rounded-full"
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [1, 0.5, 1]
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
              />
            </motion.div>

            {/* Animated Background Particles */}
            {typeof window !== 'undefined' && (
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[...Array(20)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute w-2 h-2 bg-white rounded-full opacity-30"
                    initial={{
                      x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920),
                      y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080),
                      scale: 0
                    }}
                    animate={{
                      y: [null, Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 1080)],
                      x: [null, Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1920)],
                      scale: [0, 1, 0]
                    }}
                    transition={{
                      duration: Math.random() * 3 + 2,
                      repeat: Infinity,
                      delay: Math.random() * 2,
                      ease: 'easeInOut'
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
