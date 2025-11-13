'use client'

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { MessageCircle, Send } from 'lucide-react'
import { initializePusher } from '@/lib/pusher-client'
import { toast } from 'sonner'
import { motion } from 'framer-motion'

interface ChatMessage {
  id: string
  username: string
  message: string
  createdAt: Date | string
  userId?: string // Optional unique identifier
}

interface PublicChatProps {
  auctionId: string
  rightOffsetClass?: string // optional class to shift floating button when panels are open
  hideFloatingButton?: boolean // hide the floating button (control from parent)
  externalIsOpen?: boolean // control open state from parent
  externalSetIsOpen?: (open: boolean) => void // callback to control open state from parent
}

// Memoized Message Component for performance
const ChatMessageItem = memo(({ msg, userId, isFirstInGroup }: { 
  msg: ChatMessage; 
  userId: string; 
  isFirstInGroup: boolean;
}) => {
  // Check if this message is from the current user by userId (more reliable than username)
  const isOwnMessage = msg.userId === userId
  
  return (
    <motion.div
      initial={{ opacity: 0, x: isOwnMessage ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} ${isFirstInGroup ? 'mt-2' : 'mt-0.5'}`}
    >
      <div
        className={`max-w-[75%] ${
          isOwnMessage
            ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white rounded-xl rounded-br-sm'
            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl rounded-bl-sm shadow-sm border border-gray-200 dark:border-gray-700'
        } px-2.5 py-1.5`}
      >
        {isFirstInGroup && (
          <span className={`text-[10px] font-bold block mb-0.5 ${
            isOwnMessage 
              ? 'text-white/80' 
              : 'text-teal-600 dark:text-teal-400'
          }`}>
            {isOwnMessage ? 'You' : msg.username}
          </span>
        )}
        <p className={`text-xs leading-relaxed break-words ${
          isOwnMessage ? 'text-white' : 'text-gray-900 dark:text-gray-100'
        }`}>
          {msg.message}
        </p>
      </div>
    </motion.div>
  )
})
ChatMessageItem.displayName = 'ChatMessageItem'

export function PublicChat({ auctionId, rightOffsetClass, hideFloatingButton = false, externalIsOpen, externalSetIsOpen }: PublicChatProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen
  const setIsOpen = externalSetIsOpen || setInternalIsOpen
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [username, setUsername] = useState('')
  const [userId, setUserId] = useState('')
  const [message, setMessage] = useState('')
  const [hasSetUsername, setHasSetUsername] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [flyingEmojis, setFlyingEmojis] = useState<Array<{ id: string; emoji: string; left: number }>>([])
  const messageCountRef = useRef(0)
  const lastScrollHeightRef = useRef(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const isOpenRef = useRef(isOpen)
  const [isMobile, setIsMobile] = useState(false)
  
  // Quick reaction emojis
  const quickEmojis = ['❤️', '🔥', '👏', '😂', '🎉', '😍']

  // Detect if we're on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024) // lg breakpoint
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Sync isOpenRef with isOpen and reset unread count when chat opens
  useEffect(() => {
    isOpenRef.current = isOpen
    if (isOpen) {
      setUnreadCount(0)
      // Scroll to bottom when chat opens
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [isOpen])

  // Load or generate unique user ID and username
  useEffect(() => {
    // Get or create unique user ID for this browser
    let storedUserId = sessionStorage.getItem('chat-user-id')
    if (!storedUserId) {
      storedUserId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      sessionStorage.setItem('chat-user-id', storedUserId)
    }
    setUserId(storedUserId)

    // Load username if previously set
    const savedUsername = sessionStorage.getItem(`chat-username-${auctionId}`)
    if (savedUsername) {
      setUsername(savedUsername)
      setHasSetUsername(true)
    }
  }, [auctionId])

  // Fetch initial messages
  useEffect(() => {
    if (!auctionId) return

    const fetchMessages = async () => {
      try {
        const response = await fetch(`/api/auction/${auctionId}/chat`)
        const data = await response.json()
        if (data.messages) {
          // Only keep last 50 messages in memory for performance
          setMessages(data.messages.slice(-50))
        }
      } catch (error) {
        console.error('Failed to fetch messages:', error)
      }
    }

    fetchMessages()
  }, [auctionId])

  // Subscribe to new messages via Pusher with throttling
  useEffect(() => {
    if (!auctionId) return

    const pusher = initializePusher()
    const channel = pusher.subscribe(`auction-${auctionId}`)

    // Real-time message handling - no batching for instant updates
    channel.bind('new-chat-message', (data: ChatMessage) => {
      messageCountRef.current++
      
      // Increment unread count only if chat is closed
      if (!isOpenRef.current) {
        setUnreadCount(prev => prev + 1)
      }
      
      // Update messages immediately for zero-lag real-time experience
      setMessages((prev) => {
        const updated = [...prev, data]
        // Keep only last 50 messages for performance
        return updated.length > 50 ? updated.slice(-50) : updated
      })
    })

    // Listen for emoji reactions from other users
    channel.bind('emoji-reaction', (data: { emoji: string; userId: string; timestamp: number }) => {
      console.log('🎭 Received emoji reaction event:', data)
      // Create flying emoji animation for all users
      const id = `${data.timestamp}-${Math.random()}`
      const left = Math.random() * 70 + 15 // Random position between 15% and 85%
      
      setFlyingEmojis(prev => [...prev, { id, emoji: data.emoji, left }])
      console.log('✨ Added flying emoji:', data.emoji, 'at', left + '%')
      
      // Remove after animation completes
      setTimeout(() => {
        setFlyingEmojis(prev => prev.filter(e => e.id !== id))
      }, 3500)
    })

    return () => {
      // Don't unsubscribe - let the channel persist for other components
      // Just unbind our specific handlers
      channel.unbind('new-chat-message')
      channel.unbind('emoji-reaction')
      // Note: We don't unsubscribe here to avoid interfering with other components
      // The channel will be cleaned up when all components using it unmount
    }
  }, [auctionId])

  // Optimized auto-scroll - only scroll if user is at bottom
  useEffect(() => {
    if (!messagesEndRef.current) return
    
    const container = messagesEndRef.current.parentElement
    if (!container) return
    
    const scrollHeight = container.scrollHeight
    const clientHeight = container.clientHeight
    const scrollTop = container.scrollTop
    
    // Only auto-scroll if user is within 100px of bottom
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
    
    if (isNearBottom) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    
    lastScrollHeightRef.current = scrollHeight
  }, [messages])

  const handleSetUsername = () => {
    const trimmed = username.trim()
    if (!trimmed) {
      toast.error('Please enter a username')
      return
    }
    sessionStorage.setItem(`chat-username-${auctionId}`, trimmed)
    setHasSetUsername(true)
  }

  const handleSendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim() || isSending) return

    const messageToSend = message.trim()
    const tempId = `temp-${Date.now()}-${Math.random()}`
    
    // Optimistic UI update - show message immediately for instant feedback
    const optimisticMessage: ChatMessage = {
      id: tempId,
      username,
      userId: userId || undefined,
      message: messageToSend,
      createdAt: new Date().toISOString()
    }
    
    setMessages((prev) => {
      const updated = [...prev, optimisticMessage]
      return updated.length > 50 ? updated.slice(-50) : updated
    })
    setMessage('') // Clear immediately for better UX
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
        // Remove optimistic message on error
        setMessages((prev) => prev.filter(m => m.id !== tempId))
        setMessage(messageToSend) // Restore message on error
        return
      }
      
      // Server will broadcast via Pusher, which will update with real message
      // Remove optimistic message when real one arrives (handled by Pusher event)
      // The real message will replace the optimistic one seamlessly
      setTimeout(() => {
        setMessages((prev) => prev.filter(m => m.id !== tempId))
      }, 100) // Remove optimistic message after a short delay
    } catch (error) {
      console.error('Error sending message:', error)
      toast.error('Failed to send message')
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(m => m.id !== tempId))
      setMessage(messageToSend) // Restore message on error
    } finally {
      setIsSending(false)
    }
  }, [message, isSending, auctionId, username, userId])

  const sendEmojiReaction = useCallback(async (emoji: string) => {
    // Send emoji to server to broadcast to all users
    console.log('🎭 Sending emoji reaction:', emoji)
    try {
      const response = await fetch(`/api/auction/${auctionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          userId,
          emoji 
        })
      })
      if (response.ok) {
        console.log('✅ Emoji reaction sent successfully')
      } else {
        console.error('❌ Emoji reaction failed:', response.status)
      }
    } catch (error) {
      console.error('Failed to send emoji reaction:', error)
    }
  }, [auctionId, username, userId])

  return (
    <>
      {/* Floating Chat Button - Left side on mobile, shiftable on desktop */}
      {!hideFloatingButton && (
        <div className={`fixed bottom-6 left-4 lg:left-auto ${rightOffsetClass ?? 'lg:right-20'} z-40`}>
          <Button
            onClick={() => setIsOpen(true)}
            className="rounded-full px-6 py-4 sm:px-8 sm:py-5 h-auto shadow-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white hover:scale-110 transition-transform flex items-center gap-2"
          >
            <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" />
            <span className="text-sm sm:text-base font-semibold">Chat</span>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center font-bold shadow-lg">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
        </div>
      )}

      {/* Mobile Chat Sheet - Full screen on mobile */}
      {isMobile && (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetContent
            side="bottom"
            className="h-screen max-h-screen p-0 bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden flex flex-col rounded-none"
            style={{
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              height: '100dvh', // Use dynamic viewport height to account for mobile browser UI
              maxHeight: '100dvh',
              position: 'fixed', // Ensure fixed positioning
              touchAction: 'pan-y', // Allow vertical scrolling but prevent zoom gestures
            }}
          >
          {/* Flying Emojis Overlay */}
          <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
            {flyingEmojis.map(({ id, emoji, left }) => {
              // Random zigzag offset
              const zigzagOffset = (Math.random() - 0.5) * 40 // -20 to +20
              
              return (
                <motion.div
                  key={id}
                  initial={{ 
                    bottom: '15%', // Start from emoji bar area
                    left: `${left}%`,
                    opacity: 0, 
                    scale: 0.8 
                  }}
                  animate={{ 
                    bottom: ['15%', '50%', '100%'], // Flow upward in stages
                    left: [`${left}%`, `${left + zigzagOffset}%`, `${left + zigzagOffset * 0.5}%`], // Zigzag motion
                    opacity: [0, 1, 1, 0.7, 0],
                    scale: [0.8, 1.2, 1, 0.8, 0.5],
                    rotate: [0, 10, -5, 15, 0]
                  }}
                  transition={{ 
                    duration: 3, 
                    ease: 'easeOut',
                    times: [0, 0.3, 1] // Timing for keyframes
                  }}
                  className="absolute text-2xl"
                >
                  {emoji}
                </motion.div>
              )
            })}
          </div>

          <div className="flex flex-col h-full relative min-h-0">
            {/* Header - Compact - Fixed at top - Ensure visibility */}
            <SheetHeader className="flex-shrink-0 px-4 py-2.5 border-b border-teal-200 dark:border-teal-800 bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 shadow-md relative z-20">
              <div className="w-12 h-1 bg-white/50 rounded-full mx-auto mb-1.5" />
              <SheetTitle className="text-white flex items-center justify-center gap-2 text-base font-bold">
                <MessageCircle className="h-4 w-4" />
                Live Chat 💬
              </SheetTitle>
            </SheetHeader>

            {!hasSetUsername ? (
              // Username Setup
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-br from-white/50 to-transparent">
                <div className="max-w-sm w-full space-y-6">
                  <div className="text-center space-y-2">
                    <div className="text-6xl mb-4 animate-bounce">👋</div>
                    <h3 className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-emerald-600 bg-clip-text text-transparent">
                      Welcome to the Chat!
                    </h3>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      Pick a fun name and join the conversation 🎉
                    </p>
                  </div>
                         <div className="space-y-3 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-xl border-2 border-teal-200 dark:border-teal-800">
                           <Input
                             placeholder="Your awesome name ✨"
                             value={username}
                             onChange={(e) => setUsername(e.target.value)}
                             onKeyPress={(e) => e.key === 'Enter' && handleSetUsername()}
                             maxLength={50}
                             className="text-center text-lg font-medium text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 border-2 border-teal-300 dark:border-teal-700 focus:border-teal-500 rounded-xl h-12"
                             style={{ fontSize: '16px' }}
                             inputMode="text"
                           />
                           <Button
                             onClick={handleSetUsername}
                             className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-bold text-lg h-12 rounded-xl shadow-lg hover:shadow-xl transition-all hover:scale-105"
                           >
                             🚀 Let's Chat!
                           </Button>
                         </div>
                </div>
              </div>
            ) : (
              <>
                {/* Messages - Scrollable area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-br from-white/50 to-transparent overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {messages.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-5xl mb-4">💬</div>
                      <p className="text-gray-600 dark:text-gray-400 font-medium">
                        No messages yet
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                        Be the first to say hi! 👋
                      </p>
                    </div>
                         ) : (
                           messages.map((msg, index) => {
                             const isFirstInGroup = index === 0 || messages[index - 1].username !== msg.username
                             return (
                               <ChatMessageItem 
                                 key={msg.id} 
                                 msg={msg} 
                                 userId={userId} 
                                 isFirstInGroup={isFirstInGroup}
                               />
                             )
                           })
                         )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Emoji Reactions - Fixed above input */}
                <div className="flex-shrink-0 px-4 py-2 border-t border-teal-200 dark:border-teal-800 bg-white/50 dark:bg-gray-800/50">
                  <div className="flex justify-around items-center gap-2">
                    {quickEmojis.map((emoji) => (
                      <motion.button
                        key={emoji}
                        onClick={() => {
                          console.log('🎯 Emoji clicked:', emoji, 'hasUsername:', hasSetUsername, 'username:', username)
                          sendEmojiReaction(emoji)
                        }}
                        whileTap={{ scale: 1.5 }}
                        disabled={!hasSetUsername}
                        className="text-3xl hover:scale-125 transition-transform active:scale-150 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {emoji}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Message Input - Fixed at bottom */}
                <form
                  onSubmit={handleSendMessage}
                  className="flex-shrink-0 p-3 border-t-2 border-teal-200 dark:border-teal-800 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 shadow-lg"
                  style={{
                    paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
                  }}
                >
                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="Type something fun... 💭"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      maxLength={500}
                      disabled={isSending}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="sentences"
                      spellCheck="true"
                      className="flex-1 text-gray-900 dark:text-white bg-white dark:bg-gray-700 border-2 border-teal-300 dark:border-teal-700 focus:border-teal-500 rounded-xl h-10 text-base px-3"
                      style={{ fontSize: '16px' }}
                      inputMode="text"
                    />
                    <Button
                      type="submit"
                      disabled={!message.trim() || isSending}
                      className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-xl px-4 h-10 shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex-shrink-0"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  {message.length > 0 && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                      {message.length}/500 • Press Enter to send 🚀
                    </p>
                  )}
                </form>
              </>
            )}
          </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop Compact Chat Window - Facebook Style */}
      {!isMobile && isOpen && (
        <div className={`fixed bottom-6 ${rightOffsetClass ?? 'right-20'} z-50 w-96 h-[500px] bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden min-h-0`}>
          {/* Flying Emojis Overlay */}
          <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden rounded-lg">
            {flyingEmojis.map(({ id, emoji, left }) => {
              // Random zigzag offset
              const zigzagOffset = (Math.random() - 0.5) * 40 // -20 to +20
              
              return (
                <motion.div
                  key={id}
                  initial={{ 
                    bottom: '15%', // Start from emoji bar area
                    left: `${left}%`,
                    opacity: 0, 
                    scale: 0.8 
                  }}
                  animate={{ 
                    bottom: ['15%', '50%', '100%'], // Flow upward in stages
                    left: [`${left}%`, `${left + zigzagOffset}%`, `${left + zigzagOffset * 0.5}%`], // Zigzag motion
                    opacity: [0, 1, 1, 0.7, 0],
                    scale: [0.8, 1.2, 1, 0.8, 0.5],
                    rotate: [0, 10, -5, 15, 0]
                  }}
                  transition={{ 
                    duration: 3, 
                    ease: 'easeOut',
                    times: [0, 0.3, 1] // Timing for keyframes
                  }}
                  className="absolute text-2xl"
                >
                  {emoji}
                </motion.div>
              )
            })}
          </div>
          
          {/* Compact Header - Fixed at top */}
          <div className="flex-shrink-0 bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-white" />
              <span className="text-white font-bold text-base">Live Chat</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white/80 hover:text-white text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {!hasSetUsername ? (
            // Username Setup
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-900">
              <div className="text-5xl mb-4">👋</div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Join the Chat</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 text-center">Enter your name to start chatting</p>
              <form onSubmit={(e) => { e.preventDefault(); handleSetUsername(); }} className="w-full space-y-3">
                <Input
                  type="text"
                  placeholder="Your name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600"
                  required
                  minLength={2}
                  maxLength={20}
                  style={{ fontSize: '16px' }}
                  inputMode="text"
                />
                <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700">
                  Start Chatting
                </Button>
              </form>
            </div>
          ) : (
            <>
              {/* Messages Area - Scrollable */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50 dark:bg-gray-900 overscroll-contain min-h-0">
                {messages.map((msg, index) => {
                  const prevMsg = index > 0 ? messages[index - 1] : null
                  const isFirstInGroup = !prevMsg || prevMsg.userId !== msg.userId
                  return (
                    <ChatMessageItem
                      key={msg.id}
                      msg={msg}
                      userId={userId}
                      isFirstInGroup={isFirstInGroup}
                    />
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Emojis - Fixed above input */}
              <div className="flex-shrink-0 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="flex gap-2 justify-center">
                  {quickEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        console.log('🎯 Emoji clicked:', emoji, 'hasUsername:', hasSetUsername, 'username:', username)
                        sendEmojiReaction(emoji)
                      }}
                      disabled={!hasSetUsername}
                      className="text-2xl hover:scale-125 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Form - Fixed at bottom */}
              <form 
                onSubmit={handleSendMessage} 
                className="flex-shrink-0 p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
              >
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Type a message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={isSending}
                    className="flex-1 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    maxLength={500}
                    style={{ fontSize: '16px' }}
                    inputMode="text"
                  />
                  <Button
                    type="submit"
                    disabled={!message.trim() || isSending}
                    size="sm"
                    className="bg-teal-600 hover:bg-teal-700"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </>
  )
}

