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

export function PublicChat({ auctionId }: PublicChatProps) {
  const [isOpen, setIsOpen] = useState(false)
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
  
  // Quick reaction emojis
  const quickEmojis = ['❤️', '🔥', '👏', '😂', '🎉', '😍']

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

    // Batch message updates to avoid excessive re-renders
    let messageQueue: ChatMessage[] = []
    let flushTimeout: NodeJS.Timeout | null = null

    const flushMessages = () => {
      if (messageQueue.length === 0) return
      
      setMessages((prev) => {
        const updated = [...prev, ...messageQueue]
        messageQueue = []
        // Keep only last 50 messages for performance
        return updated.length > 50 ? updated.slice(-50) : updated
      })
    }

    channel.bind('new-chat-message', (data: ChatMessage) => {
      messageQueue.push(data)
      messageCountRef.current++
      
      // Flush immediately if queue is small, batch if high traffic
      if (messageQueue.length >= 5) {
        if (flushTimeout) clearTimeout(flushTimeout)
        flushMessages()
      } else {
        if (flushTimeout) clearTimeout(flushTimeout)
        flushTimeout = setTimeout(flushMessages, 100)
      }
    })

    return () => {
      if (flushTimeout) clearTimeout(flushTimeout)
      flushMessages() // Flush remaining messages
      channel.unbind('new-chat-message')
      pusher.unsubscribe(`auction-${auctionId}`)
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

    const messageToSend = message
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
        setMessage(messageToSend) // Restore message on error
        return
      }
    } catch (error) {
      console.error('Error sending message:', error)
      toast.error('Failed to send message')
      setMessage(messageToSend) // Restore message on error
    } finally {
      setIsSending(false)
    }
  }, [message, isSending, auctionId, username, userId])

  const sendEmojiReaction = useCallback((emoji: string) => {
    // Create flying emoji - just visual, not saved to chat
    const id = `${Date.now()}-${Math.random()}`
    const left = Math.random() * 70 + 15 // Random position between 15% and 85%
    
    setFlyingEmojis(prev => [...prev, { id, emoji, left }])
    
    // Remove after animation completes
    setTimeout(() => {
      setFlyingEmojis(prev => prev.filter(e => e.id !== id))
    }, 3500)
  }, [])

  return (
    <>
      {/* Floating Chat Button - Left side on mobile, right side on desktop */}
      <div className="fixed bottom-6 left-4 lg:left-auto lg:right-20 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-full px-6 py-4 sm:px-8 sm:py-5 h-auto shadow-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white hover:scale-110 transition-transform flex items-center gap-2"
        >
          <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" />
          <span className="text-sm sm:text-base font-semibold">Chat</span>
          {messages.length > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center font-bold shadow-lg">
              {messages.length > 99 ? '99+' : messages.length}
            </span>
          )}
        </Button>
      </div>

      {/* Chat Sheet */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="bottom"
          className="h-[80vh] sm:h-[70vh] p-0 bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden"
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

          <div className="flex flex-col h-full relative">
            {/* Header */}
            <SheetHeader className="px-4 py-4 border-b-2 border-teal-200 dark:border-teal-800 bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 shadow-lg">
              <div className="w-12 h-1.5 bg-white/50 rounded-full mx-auto mb-3" />
              <SheetTitle className="text-white flex items-center justify-center gap-2 text-xl font-bold">
                <MessageCircle className="h-6 w-6 animate-pulse" />
                Live Chat 💬
              </SheetTitle>
              <SheetDescription className="text-white/90 text-center">
                Join the conversation • Be respectful
              </SheetDescription>
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
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-br from-white/50 to-transparent">
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

                {/* Quick Emoji Reactions */}
                <div className="px-4 py-2 border-t border-teal-200 dark:border-teal-800 bg-white/50 dark:bg-gray-800/50">
                  <div className="flex justify-around items-center gap-2">
                    {quickEmojis.map((emoji) => (
                      <motion.button
                        key={emoji}
                        onClick={() => sendEmojiReaction(emoji)}
                        whileTap={{ scale: 1.5 }}
                        className="text-3xl hover:scale-125 transition-transform active:scale-150"
                      >
                        {emoji}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Message Input */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 border-t-2 border-teal-200 dark:border-teal-800 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 shadow-lg"
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
    </>
  )
}

