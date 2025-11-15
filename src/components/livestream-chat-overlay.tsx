'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Send, Smile } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { initializePusher } from '@/lib/pusher-client'
import { toast } from 'sonner'

interface ChatMessage {
  id: string
  username: string
  message: string
  createdAt: Date | string
  userId?: string
}

interface LiveStreamChatOverlayProps {
  auctionId: string
}

// Optimized constants for high-traffic scenarios
const MAX_VISIBLE_MESSAGES = 10
const MESSAGE_DISPLAY_DURATION = 12000 // 12 seconds
const REACTION_ANIMATION_DURATION = 3000 // 3 seconds
const MESSAGE_BATCH_DELAY = 100 // Batch messages every 100ms
const MAX_REACTIONS_ON_SCREEN = 20 // Limit simultaneous reactions

// Quick reaction emojis
const quickEmojis = ['❤️', '🔥', '👏', '😂', '🎉', '😍']

export function LiveStreamChatOverlay({ auctionId }: LiveStreamChatOverlayProps) {
  const [messages, setMessages] = useState<(ChatMessage & { displayId: string })[]>([])
  const [username, setUsername] = useState('')
  const [userId, setUserId] = useState('')
  const [message, setMessage] = useState('')
  const [hasSetUsername, setHasSetUsername] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [reactions, setReactions] = useState<Array<{ id: string; emoji: string; rightOffset: number }>>([])
  
  const messageTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const pendingMessagesRef = useRef<(ChatMessage & { displayId: string })[]>([])
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const reactionQueueRef = useRef<Array<{ emoji: string; timestamp: number }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Load user ID and username
  useEffect(() => {
    let storedUserId = sessionStorage.getItem('chat-user-id')
    if (!storedUserId) {
      storedUserId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      sessionStorage.setItem('chat-user-id', storedUserId)
    }
    setUserId(storedUserId)

    const savedUsername = sessionStorage.getItem(`chat-username-${auctionId}`)
    if (savedUsername) {
      setUsername(savedUsername)
      setHasSetUsername(true)
    }
  }, [auctionId])

  // Optimized message batching using requestAnimationFrame
  const flushPendingMessages = useCallback(() => {
    if (pendingMessagesRef.current.length === 0) return

    const messagesToAdd = [...pendingMessagesRef.current]
    pendingMessagesRef.current = []

    setMessages((prev) => {
      const combined = [...prev, ...messagesToAdd]
      
      // Keep only the last MAX_VISIBLE_MESSAGES
      const toKeep = combined.slice(-MAX_VISIBLE_MESSAGES)
      
      // Clear timeouts for removed messages
      if (combined.length > MAX_VISIBLE_MESSAGES) {
        const removed = combined.slice(0, combined.length - MAX_VISIBLE_MESSAGES)
        removed.forEach((msg) => {
          const timeout = messageTimeoutsRef.current.get(msg.displayId)
          if (timeout) {
            clearTimeout(timeout)
            messageTimeoutsRef.current.delete(msg.displayId)
          }
        })
      }
      
      return toKeep
    })

    // Schedule removal for new messages
    messagesToAdd.forEach((msg) => {
      const timeout = setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.displayId !== msg.displayId))
        messageTimeoutsRef.current.delete(msg.displayId)
      }, MESSAGE_DISPLAY_DURATION)
      
      messageTimeoutsRef.current.set(msg.displayId, timeout)
    })
  }, [])

  // Debounced message addition
  const addMessageBatched = useCallback((data: ChatMessage) => {
    const displayId = `${data.id}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    pendingMessagesRef.current.push({ ...data, displayId })

    // Cancel existing batch timeout
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current)
    }

    // Schedule new batch flush
    batchTimeoutRef.current = setTimeout(() => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }
      rafIdRef.current = requestAnimationFrame(flushPendingMessages)
    }, MESSAGE_BATCH_DELAY)
  }, [flushPendingMessages])

  // Throttled reaction handler
  const addReactionThrottled = useCallback((emoji: string, timestamp: number) => {
    const id = `${timestamp}-${Math.random()}`
    const rightOffset = Math.random() * 30
    
    // Limit reactions on screen
    setReactions((prev) => {
      if (prev.length >= MAX_REACTIONS_ON_SCREEN) {
        return prev // Drop new reactions if too many
      }
      
      return [...prev, { id, emoji, rightOffset }]
    })

    // Schedule removal with the SAME id that was created
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id))
    }, REACTION_ANIMATION_DURATION)
  }, [])

  // Subscribe to Pusher events with optimized handlers
  useEffect(() => {
    if (!auctionId) return

    const pusher = initializePusher()
    const channel = pusher.subscribe(`auction-${auctionId}`)

    // Optimized message handler
    channel.bind('new-chat-message', (data: ChatMessage) => {
      addMessageBatched(data)
    })

    // Optimized reaction handler with throttling
    let reactionBuffer: Array<{ emoji: string; timestamp: number }> = []
    let reactionFlushTimeout: NodeJS.Timeout | null = null

    channel.bind('emoji-reaction', (data: { emoji: string; userId: string; timestamp: number }) => {
      reactionBuffer.push({ emoji: data.emoji, timestamp: data.timestamp })

      if (reactionFlushTimeout) clearTimeout(reactionFlushTimeout)

      reactionFlushTimeout = setTimeout(() => {
        // Process buffered reactions
        reactionBuffer.forEach(({ emoji, timestamp }) => {
          addReactionThrottled(emoji, timestamp)
        })
        reactionBuffer = []
      }, 50) // Flush reactions every 50ms
    })

    return () => {
      channel.unbind('new-chat-message')
      channel.unbind('emoji-reaction')
      pusher.unsubscribe(`auction-${auctionId}`)
      if (reactionFlushTimeout) clearTimeout(reactionFlushTimeout)
    }
  }, [auctionId, addMessageBatched, addReactionThrottled])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      messageTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      messageTimeoutsRef.current.clear()
      if (batchTimeoutRef.current) clearTimeout(batchTimeoutRef.current)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const handleSendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim() || isSending || !hasSetUsername) return

    const messageToSend = message.trim()
    setMessage('')
    setIsSending(true)

    try {
      const response = await fetch(`/api/auction/${auctionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          userId,
          message: messageToSend 
        })
      })

      if (!response.ok) {
        const error = await response.json()
        toast.error(error.error || 'Failed to send message')
        setMessage(messageToSend)
      }
    } catch (error) {
      console.error('Error sending message:', error)
      toast.error('Failed to send message')
      setMessage(messageToSend)
    } finally {
      setIsSending(false)
      // Re-focus input after sending
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [message, isSending, auctionId, username, userId, hasSetUsername])

  // Client-side reaction throttle (max 5 per second)
  const lastReactionTimeRef = useRef<number>(0)
  const reactionCountRef = useRef<number>(0)
  
  const sendEmojiReaction = useCallback(async (emoji: string) => {
    if (!hasSetUsername) {
      toast.error('Please set a username first')
      return
    }

    // Client-side throttle: max 5 reactions per second
    const now = Date.now()
    const timeSinceLastReset = now - lastReactionTimeRef.current
    
    if (timeSinceLastReset >= 1000) {
      // Reset counter every second
      reactionCountRef.current = 0
      lastReactionTimeRef.current = now
    }
    
    if (reactionCountRef.current >= 5) {
      // Silently drop extra reactions (don't show error to user)
      return
    }
    
    reactionCountRef.current++

    try {
      // Fire and forget - don't await
      fetch(`/api/auction/${auctionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, userId, emoji })
      }).catch(console.error)
    } catch (error) {
      console.error('Failed to send emoji reaction:', error)
    }
  }, [auctionId, username, userId, hasSetUsername])

  // Memoized message rendering for better performance
  const renderedMessages = useMemo(() => {
    return messages.map((msg) => {
      const isOwnMessage = msg.userId === userId
      return (
        <motion.div
          key={msg.displayId}
          initial={{ opacity: 0, x: -50, y: 20, filter: 'blur(4px)' }}
          animate={{ opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }}
          exit={{ 
            opacity: [1, 0.7, 0.3, 0],
            y: [-5, -20, -40, -70],
            scale: [1, 1.02, 1.05, 1.08],
            filter: ['blur(0px)', 'blur(1px)', 'blur(3px)', 'blur(6px)']
          }}
          transition={{ 
            duration: 0.3,
            delay: 0,
            layout: { duration: 0.2 }
          }}
          layout
          className="mb-1.5"
        >
          <div
            className={`rounded-xl px-2.5 py-1.5 shadow-lg backdrop-blur-sm will-change-transform ${
              isOwnMessage ? 'bg-teal-500/60' : 'bg-black/60'
            }`}
          >
            <div className="flex items-start gap-1.5 max-w-full">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 mt-0.5 ${
                isOwnMessage ? 'bg-white/30 text-white' : 'bg-teal-500 text-white'
              }`}>
                {isOwnMessage ? '👤' : msg.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                <span className={`text-[10px] font-bold ${
                  isOwnMessage ? 'text-white' : 'text-teal-300'
                }`}>
                  {isOwnMessage ? 'You' : msg.username}:{' '}
                </span>
                <span className="text-[11px] font-semibold text-white leading-tight">
                  {msg.message}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )
    })
  }, [messages, userId])

  return (
    <>
      {/* Dimmed Overlay */}
      <AnimatePresence>
        {showInput && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40"
            onClick={() => setShowInput(false)}
          />
        )}
      </AnimatePresence>

      {/* Floating Chat Messages */}
      <div 
        className="fixed left-3 bottom-[140px] sm:bottom-20 z-50 pointer-events-none max-w-[70%] sm:max-w-sm flex flex-col justify-end"
        style={{
          maxHeight: showInput ? 'calc(100vh - 300px)' : 'calc(100vh - 220px)',
          willChange: 'transform',
        }}
      >
        <AnimatePresence mode="popLayout">
          {renderedMessages}
        </AnimatePresence>
      </div>

      {/* Vertical Reactions */}
      <div className="fixed right-2 bottom-32 sm:bottom-20 top-20 z-50 pointer-events-none overflow-hidden w-12">
        <AnimatePresence>
          {reactions.map(({ id, emoji, rightOffset }) => (
            <motion.div
              key={id}
              initial={{ y: 0, x: rightOffset, opacity: 0, scale: 0.5 }}
              animate={{ 
                y: -window.innerHeight + 100,
                opacity: [0, 1, 1, 0.5, 0],
                scale: [0.5, 1.2, 1, 0.8, 0.5],
                rotate: [0, -10, 10, -5, 0]
              }}
              transition={{ 
                duration: REACTION_ANIMATION_DURATION / 1000,
                ease: 'easeOut'
              }}
              className="absolute bottom-0 text-3xl will-change-transform"
            >
              {emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Control Buttons - Horizontal Layout */}
      <div className="fixed bottom-20 sm:bottom-4 right-4 z-50 pointer-events-auto">
        {/* Quick Reactions Menu - Positioned Above Buttons */}
        <AnimatePresence>
          {showReactions && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              className="absolute bottom-full right-0 mb-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-2xl p-2 shadow-2xl border border-gray-200 dark:border-gray-700"
            >
              <div className="grid grid-cols-3 gap-1">
                {quickEmojis.map((emoji) => (
                  <motion.button
                    key={emoji}
                    onClick={() => sendEmojiReaction(emoji)}
                    whileTap={{ scale: 1.5 }}
                    disabled={!hasSetUsername}
                    className="text-3xl p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {emoji}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Buttons Row */}
        <div className="flex flex-row gap-2 items-center">
          {/* Reactions Button - Compact Design */}
          <motion.div 
            initial={false} 
            animate={{ scale: showReactions ? 1.05 : 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              onClick={() => {
                if (!hasSetUsername) {
                  toast.error('Please set a username first')
                  return
                }
                setShowReactions(!showReactions)
                setShowInput(false)
              }}
              className="relative rounded-xl h-11 w-11 bg-gradient-to-br from-pink-500 via-rose-500 to-orange-500 hover:from-pink-600 hover:via-rose-600 hover:to-orange-600 shadow-[0_4px_20px_rgba(236,72,153,0.4)] hover:shadow-[0_6px_25px_rgba(236,72,153,0.6)] transition-all duration-300 border border-white/20"
            >
              {/* Glossy overlay effect */}
              <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/25 to-transparent opacity-50" />
              {/* Icon with drop shadow */}
              <div className="relative flex items-center justify-center">
                <Smile className="h-5 w-5 text-white drop-shadow-md" strokeWidth={2.5} />
              </div>
              {/* Pulse ring effect */}
              {showReactions && (
                <motion.div
                  className="absolute inset-0 rounded-xl border-2 border-pink-400"
                  initial={{ scale: 1, opacity: 0.8 }}
                  animate={{ scale: 1.3, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </Button>
          </motion.div>

          {/* Chat Button - Compact Design */}
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <Button
              onClick={() => {
                if (!hasSetUsername) {
                  const name = prompt('Please enter a username to chat:')
                  if (name) {
                    sessionStorage.setItem(`chat-username-${auctionId}`, name.trim())
                    setUsername(name.trim())
                    setHasSetUsername(true)
                    toast.success(`Welcome, ${name.trim()}! 👋`)
                    setShowInput(true)
                  }
                } else {
                  setShowInput(!showInput)
                  setShowReactions(false)
                }
              }}
              className="relative rounded-xl h-12 w-12 bg-gradient-to-br from-teal-500 via-emerald-500 to-cyan-500 hover:from-teal-600 hover:via-emerald-600 hover:to-cyan-600 shadow-[0_4px_20px_rgba(20,184,166,0.5)] hover:shadow-[0_6px_28px_rgba(20,184,166,0.7)] transition-all duration-300 border border-white/25"
            >
              {/* Glossy overlay effect */}
              <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/30 to-transparent opacity-50" />
              {/* Icon with enhanced styling */}
              <div className="relative flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-white drop-shadow-md" strokeWidth={2.5} fill="white" fillOpacity="0.2" />
              </div>
              {/* Active indicator when chat is open */}
              {showInput && (
                <motion.div
                  className="absolute -top-0.5 -right-0.5 h-3 w-3 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full border-2 border-white shadow-md"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Message Input */}
      <AnimatePresence>
        {showInput && hasSetUsername && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-700 shadow-2xl pointer-events-auto"
            style={{
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
            }}
          >
            <form onSubmit={handleSendMessage} className="px-3 py-2.5 bg-gradient-to-r from-teal-50/80 via-emerald-50/80 to-cyan-50/80 dark:from-gray-800/80 dark:via-gray-800/80 dark:to-gray-800/80">
              <div className="flex gap-2 items-center max-w-2xl mx-auto">
                <div className="flex-1 relative group">
                  <Input
                    ref={inputRef}
                    placeholder="Type a message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && message.trim() && !isSending) {
                        e.preventDefault()
                        handleSendMessage(e as any)
                      }
                    }}
                    onBlur={(e) => {
                      // Re-focus if input is still open and not clicking send/close buttons
                      setTimeout(() => {
                        if (showInput && document.activeElement?.tagName !== 'BUTTON') {
                          inputRef.current?.focus()
                        }
                      }, 100)
                    }}
                    maxLength={500}
                    disabled={isSending}
                    autoFocus
                    className="w-full bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-2 border-teal-200 dark:border-teal-800/50 rounded-lg h-9 px-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-teal-400 dark:focus:border-teal-500 focus:ring-2 focus:ring-teal-400/30 dark:focus:ring-teal-500/30 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-sm hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700"
                    style={{ fontSize: '14px' }}
                  />
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 opacity-0 group-focus-within:opacity-20 blur-sm transition-opacity pointer-events-none -z-10" />
                  {message.length > 400 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-teal-600 dark:text-teal-400 pointer-events-none">
                      {message.length}/500
                    </span>
                  )}
                </div>
                
                <Button
                  type="submit"
                  disabled={!message.trim() || isSending}
                  className={`h-9 w-9 rounded-lg p-0 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                    message.trim() 
                      ? 'bg-gradient-to-br from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white shadow-md hover:shadow-lg hover:shadow-teal-500/50 hover:scale-105 active:scale-95' 
                      : 'bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed shadow-sm'
                  }`}
                >
                  <Send className="h-4 w-4" />
                </Button>
                
                <Button
                  type="button"
                  onClick={() => setShowInput(false)}
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 rounded-lg flex items-center justify-center flex-shrink-0 text-gray-600 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all duration-200"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

