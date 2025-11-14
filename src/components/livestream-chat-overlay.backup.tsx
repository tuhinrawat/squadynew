'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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

// Maximum messages visible on screen at once (TikTok/YouTube style)
const MAX_VISIBLE_MESSAGES = 10
const MESSAGE_DISPLAY_DURATION = 8000 // 8 seconds per message
const REACTION_ANIMATION_DURATION = 3000 // 3 seconds for reactions

// Quick reaction emojis (same as before)
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

  // Load or generate unique user ID and username
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

  // Auto-remove messages after display duration (FIFO queue)
  const scheduleMessageRemoval = useCallback((displayId: string) => {
    const timeout = setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.displayId !== displayId))
      messageTimeoutsRef.current.delete(displayId)
    }, MESSAGE_DISPLAY_DURATION)
    
    messageTimeoutsRef.current.set(displayId, timeout)
  }, [])

  // Subscribe to new messages via Pusher
  useEffect(() => {
    if (!auctionId) return

    const pusher = initializePusher()
    const channel = pusher.subscribe(`auction-${auctionId}`)

    channel.bind('new-chat-message', (data: ChatMessage) => {
      const displayId = `${data.id}-${Date.now()}`
      
      setMessages((prev) => {
        // Keep only last MAX_VISIBLE_MESSAGES
        const updated = [...prev, { ...data, displayId }]
        
        // If exceeding max, remove oldest messages immediately
        if (updated.length > MAX_VISIBLE_MESSAGES) {
          const toRemove = updated.slice(0, updated.length - MAX_VISIBLE_MESSAGES)
          toRemove.forEach((msg) => {
            const timeout = messageTimeoutsRef.current.get(msg.displayId)
            if (timeout) {
              clearTimeout(timeout)
              messageTimeoutsRef.current.delete(msg.displayId)
            }
          })
          return updated.slice(-MAX_VISIBLE_MESSAGES)
        }
        
        return updated
      })

      // Schedule auto-removal for this message
      scheduleMessageRemoval(displayId)
    })

    channel.bind('emoji-reaction', (data: { emoji: string; userId: string; timestamp: number }) => {
      // Create vertical floating reaction on right side
      const id = `${data.timestamp}-${Math.random()}`
      const rightOffset = Math.random() * 30 // Random offset 0-30px for variety
      
      setReactions((prev) => [...prev, { id, emoji: data.emoji, rightOffset }])
      
      // Remove after animation completes
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id))
      }, REACTION_ANIMATION_DURATION)
    })

    return () => {
      channel.unbind('new-chat-message')
      channel.unbind('emoji-reaction')
    }
  }, [auctionId, scheduleMessageRemoval])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      messageTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      messageTimeoutsRef.current.clear()
    }
  }, [])

  const handleSetUsername = () => {
    const trimmed = username.trim()
    if (!trimmed) {
      toast.error('Please enter a username')
      return
    }
    sessionStorage.setItem(`chat-username-${auctionId}`, trimmed)
    setHasSetUsername(true)
    toast.success(`Welcome, ${trimmed}! 👋`)
  }

  const handleSendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim() || isSending || !hasSetUsername) return

    const messageToSend = message.trim()
    setMessage('') // Clear input but keep it open for next message
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
        return
      }
    } catch (error) {
      console.error('Error sending message:', error)
      toast.error('Failed to send message')
      setMessage(messageToSend)
    } finally {
      setIsSending(false)
    }
  }, [message, isSending, auctionId, username, userId, hasSetUsername])

  const sendEmojiReaction = useCallback(async (emoji: string) => {
    if (!hasSetUsername) {
      toast.error('Please set a username first')
      return
    }

    // Don't close reactions menu - let users send multiple reactions
    
    try {
      await fetch(`/api/auction/${auctionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          userId,
          emoji 
        })
      })
    } catch (error) {
      console.error('Failed to send emoji reaction:', error)
    }
  }, [auctionId, username, userId, hasSetUsername])

  return (
    <>
      {/* Dimmed Overlay - When input is open */}
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

      {/* Floating Chat Messages Overlay - Bottom Left (TikTok/YouTube style) */}
      <div 
        className="fixed left-3 z-50 pointer-events-none max-w-[70%] sm:max-w-sm flex flex-col justify-end"
        style={{
          bottom: showInput ? '80px' : '80px', // Position above controls
          maxHeight: showInput ? 'calc(100vh - 250px)' : 'calc(100vh - 180px)', // Adjust height based on input state
        }}
      >
        <AnimatePresence mode="popLayout">
          {messages.map((msg, index) => {
            const isOwnMessage = msg.userId === userId
            return (
              <motion.div
                key={msg.displayId}
                initial={{ opacity: 0, x: -50, y: 20 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, x: -20, scale: 0.8 }}
                transition={{ 
                  duration: 0.3,
                  delay: 0,
                  layout: { duration: 0.2 }
                }}
                layout
                className="mb-1.5"
              >
                <div
                  className={`rounded-xl px-2.5 py-1.5 shadow-lg backdrop-blur-sm ${
                    isOwnMessage
                      ? 'bg-teal-500/60'
                      : 'bg-black/60'
                  }`}
                >
                  {/* Compact single line with username and message */}
                  <div className="flex items-center gap-1.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 ${
                      isOwnMessage 
                        ? 'bg-white/30 text-white' 
                        : 'bg-teal-500 text-white'
                    }`}>
                      {isOwnMessage ? '👤' : msg.username.charAt(0).toUpperCase()}
                    </div>
                    <span className={`text-[10px] font-bold flex-shrink-0 ${
                      isOwnMessage ? 'text-white' : 'text-teal-300'
                    }`}>
                      {isOwnMessage ? 'You' : msg.username}:
                    </span>
                    <span className="text-[11px] font-semibold text-white leading-tight break-words">
                      {msg.message}
                    </span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Vertical Reactions - Right Side (TikTok style) */}
      <div className="fixed right-2 bottom-20 top-20 z-50 pointer-events-none overflow-hidden w-12">
        <AnimatePresence>
          {reactions.map(({ id, emoji, rightOffset }) => (
            <motion.div
              key={id}
              initial={{ 
                y: 0,
                x: rightOffset,
                opacity: 0,
                scale: 0.5
              }}
              animate={{ 
                y: -window.innerHeight + 100, // Float to top
                opacity: [0, 1, 1, 0.5, 0],
                scale: [0.5, 1.2, 1, 0.8, 0.5],
                rotate: [0, -10, 10, -5, 0]
              }}
              transition={{ 
                duration: REACTION_ANIMATION_DURATION / 1000,
                ease: 'easeOut'
              }}
              className="absolute bottom-0 text-3xl"
            >
              {emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Control Buttons - Bottom Right */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-auto">
        {/* Reactions Button */}
        <motion.div
          initial={false}
          animate={{ scale: showReactions ? 1.05 : 1 }}
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
            className="rounded-full h-12 w-12 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 shadow-xl"
          >
            <Smile className="h-5 w-5 text-white" />
          </Button>
        </motion.div>

        {/* Quick Reactions Menu */}
        <AnimatePresence>
          {showReactions && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-2xl p-2 shadow-2xl border border-gray-200 dark:border-gray-700 pointer-events-auto"
            >
              <div className="grid grid-cols-3 gap-1">
                {quickEmojis.map((emoji) => (
                  <motion.button
                    key={emoji}
                    onClick={() => sendEmojiReaction(emoji)}
                    whileTap={{ scale: 1.3 }}
                    className="text-3xl p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                  >
                    {emoji}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Button */}
        <Button
          onClick={() => {
            if (!hasSetUsername) {
              // Show username input in a toast or modal
              const name = prompt('Enter your username:')
              if (name && name.trim()) {
                setUsername(name.trim())
                sessionStorage.setItem(`chat-username-${auctionId}`, name.trim())
                setHasSetUsername(true)
                toast.success(`Welcome, ${name.trim()}! 👋`)
                setShowInput(true)
              }
            } else {
              setShowInput(!showInput)
              setShowReactions(false)
            }
          }}
          className="rounded-full h-14 w-14 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 shadow-xl"
        >
          <MessageCircle className="h-6 w-6 text-white" />
        </Button>
      </div>

      {/* Message Input - Bottom (slides up when active) */}
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
                {/* Input Container - Brilliant Design */}
                <div className="flex-1 relative group">
                  <Input
                    placeholder="Type a message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && message.trim() && !isSending) {
                        e.preventDefault()
                        handleSendMessage(e as any)
                      }
                    }}
                    maxLength={500}
                    disabled={isSending}
                    autoFocus
                    className="w-full bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-2 border-teal-200 dark:border-teal-800/50 rounded-lg h-9 px-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-teal-400 dark:focus:border-teal-500 focus:ring-2 focus:ring-teal-400/30 dark:focus:ring-teal-500/30 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-sm hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700"
                    style={{ fontSize: '14px' }}
                  />
                  {/* Animated border glow */}
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 opacity-0 group-focus-within:opacity-20 blur-sm transition-opacity pointer-events-none -z-10" />
                  {/* Character counter */}
                  {message.length > 400 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-teal-600 dark:text-teal-400 pointer-events-none">
                      {message.length}/500
                    </span>
                  )}
                </div>
                
                {/* Send Button - Brilliant Gradient */}
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
                
                {/* Close Button - Subtle Colored */}
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

