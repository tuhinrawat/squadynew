'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition, memo } from 'react'
import { useRouter } from 'next/navigation'
import { Auction, Player, Bidder } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Clock, Play, Pause, SkipForward, Square, Undo2, TrendingUp, ChevronDown, ChevronUp, Share2, MoreVertical, Trophy, RotateCcw, WifiOff, Download, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePusher, useAdminPusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { ActivityLog } from '@/components/activity-log'
import { isLiveStatus } from '@/lib/auction-status'
import { formatCurrency } from '@/lib/currency'
import { extractCricheroesLink } from '@/lib/cricheroes'
import { extractBattingStats, extractBowlingStats } from '@/lib/cricket-stats'
import PlayerCard from '@/components/player-card'
import BidAmountStrip from '@/components/bid-amount-strip'
import ActionButtons from '@/components/action-buttons'
import { PlayerRevealAnimation } from '@/components/player-reveal-animation'
import { GoingLiveBanner } from '@/components/going-live-banner'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { preloadImage } from '@/lib/image-preloader'
import { saveOfflineSnapshot } from '@/lib/offline-auction-store'
import { useConnectivityBeacon } from '@/hooks/use-connectivity-beacon'

interface BidHistoryEntry {
  bidderId?: string // Optional for sale-undo events
  amount?: number // Optional for sale-undo events
  timestamp: Date
  bidderName?: string // Optional for sale-undo events
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold' | 'sale-undo' | 'bid-undo'
  playerId?: string
  playerName?: string
  refundedAmount?: number // For sale-undo events
}

interface BidderWithUser extends Bidder {
      user: {
        id: string
        name: string
        email: string
      }
}

interface PusherBidData {
  bidderId: string
  bidderName: string
  teamName?: string
  amount: number
  timestamp: string
  remainingPurse?: number // Added for instant UI updates
  currentBid?: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  }
}

interface PusherBidUndoData {
  bidderId: string
  currentBid: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  } | null
  countdownSeconds: number
  remainingPurse?: number // Added for instant UI updates
}

interface PusherSoldData {
  playerId: string
  bidderId: string
  bidderName?: string
  teamName?: string
  amount: number
  playerName: string
  bidderRemainingPurse?: number // Added for instant UI updates
  updatedBidders?: Array<{ id: string; remainingPurse: number }> // Batch updates
}

interface PusherSaleUndoData {
  playerId: string
  player?: any // Updated player data after undo
  bidderId?: string
  refundedAmount?: number
  bidderRemainingPurse?: number
  updatedBidders?: Array<{ id: string; remainingPurse: number }>
  undoneType?: 'sold' | 'unsold'
}

interface PusherPlayerData {
  player: Player
}

interface AuctionRules {
  minBidIncrement?: number
  countdownSeconds?: number
  // Add other rule properties as needed
}

interface BidConsolePanelProps {
  bidders: BidderWithUser[]
  highestBidderId: string | null
  currentBid: { bidderId: string; amount: number; bidderName: string; teamName?: string } | null
  isPlacingBid: boolean
  minIncrement: number
  selectedAmount: number | null
  selectedBidderId: string | null
  customInput: string
  onSelectAmount: (amount: number | null) => void
  onSelectBidder: (id: string) => void
  onCustomInputChange: (raw: string) => void
  onConfirm: () => void
  showClose?: boolean
  onClose?: () => void
}

// Same extraction the player card itself uses (duplicated inline there too -
// see the imageUrl IIFE below) - kept standalone here since the prefetch
// effect needs it before any player is actually being rendered.
function extractPlayerImageUrl(data: Record<string, unknown> | null | undefined): string | undefined {
  const keys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
  const value = keys.map(key => data?.[key]).find(v => v && String(v).trim())
  if (!value) return undefined
  const photoStr = String(value).trim()
  let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return `/api/proxy-image?id=${match[1]}`
  match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return `/api/proxy-image?id=${match[1]}`
  if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) return photoStr
  return undefined
}

// A real, stable, module-scope component - NOT a useCallback/useMemo defined
// inline in AdminAuctionView's render. A component whose function identity
// changes across renders (as a useCallback would, once its deps include
// fast-changing state like typed input) makes React treat each render as a
// different component TYPE, unmounting and remounting the whole subtree -
// including the <input> DOM node, which drops focus after every keystroke.
// Taking props instead of closing over parent state keeps this identity
// stable while still reflecting every state change via normal re-renders.
function BidConsolePanel({
  bidders,
  highestBidderId,
  currentBid,
  isPlacingBid,
  minIncrement,
  selectedAmount,
  selectedBidderId,
  customInput,
  onSelectAmount,
  onSelectBidder,
  onCustomInputChange,
  onConfirm,
  showClose = false,
  onClose
}: BidConsolePanelProps) {
  const currentBidAmount = currentBid?.amount || 0
  // Chips are always expressed as "current bid + N increments" so they're
  // always valid and always relevant, however high the price has climbed -
  // but labeled with the resulting absolute total, since that's what gets
  // called out on the floor ("ten thousand!", not "plus six thousand!").
  const chipMultiples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50]
  const quickAmounts = chipMultiples.map(m => currentBidAmount + m * minIncrement)
  const selectedBidder = bidders.find(b => b.id === selectedBidderId)
  const amountInvalid = selectedAmount != null && selectedAmount <= currentBidAmount
  const canConfirm = selectedAmount != null && !!selectedBidderId && !amountInvalid && !isPlacingBid

  return (
    <div className="h-screen w-full bg-[#0b0f16] shadow-[-8px_0_24px_rgba(0,0,0,0.3)] flex flex-col pointer-events-auto overflow-hidden">
      <div className="p-3 bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg flex flex-col gap-1 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-white" />
            <div className="text-sm font-bold text-white">Bidding Console</div>
          </div>
          {showClose && (
            <button
              className="text-white/90 hover:text-white hover:bg-white/20 rounded-lg px-2 py-1 text-xs font-medium transition-all"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 text-white">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">Current Bid</span>
          <span className="text-base font-black tabular-nums">₹{currentBidAmount.toLocaleString('en-IN')}</span>
          {currentBid?.bidderName && <span className="text-xs font-semibold text-white/85">&middot; {currentBid.bidderName}</span>}
        </div>
      </div>

      {/* Amount composer */}
      <div className="p-2.5 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Amount Heard</span>
          {selectedAmount != null && (
            <button
              className="text-[10px] font-bold text-gray-500 hover:text-gray-300"
              onClick={() => onSelectAmount(null)}
            >
              Clear &times;
            </button>
          )}
        </div>
        <div className={`rounded-lg border px-3 py-2 mb-2 text-center ${amountInvalid ? 'border-red-500/50' : 'border-white/10'} bg-white/[0.04]`}>
          <span className={`text-xl font-black tabular-nums ${selectedAmount == null ? 'text-gray-600' : amountInvalid ? 'text-red-400' : 'text-teal-400'}`}>
            {selectedAmount != null ? `₹${selectedAmount.toLocaleString('en-IN')}` : 'Tap or type'}
          </span>
          {amountInvalid && (
            <div className="text-[10px] font-bold text-red-400 mt-0.5">Must exceed ₹{(currentBidAmount + minIncrement).toLocaleString('en-IN')}</div>
          )}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {quickAmounts.map(amt => (
            <button
              key={amt}
              className={`h-7 rounded text-[10px] font-bold ${selectedAmount === amt ? 'bg-teal-500 text-gray-950' : 'bg-white/[0.06] text-gray-200 hover:bg-white/[0.12]'}`}
              onClick={() => onSelectAmount(amt)}
            >
              {amt >= 100000 ? `${amt / 100000}L` : `${amt / 1000}K`}
            </button>
          ))}
        </div>
        <input
          type="text"
          inputMode="numeric"
          placeholder="Type an exact amount"
          value={customInput}
          onChange={(e) => onCustomInputChange(e.target.value)}
          className="w-full mt-2 bg-white/[0.05] border border-white/15 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-gray-500"
        />
      </div>

      {/* Bidder roster - grouped by first letter of name, like a contacts
          list, so a specific bidder can be found by eye instead of
          scanning the whole grid. Relies on `bidders` already arriving
          sorted alphabetically (see sortedBidders in the parent). */}
      <div className="p-2.5 flex-1 min-h-0 overflow-y-auto">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Tap Who Called It &middot; {bidders.length} Bidders</div>
        {(() => {
          const groups: { letter: string; bidders: BidderWithUser[] }[] = []
          bidders.forEach(bidder => {
            const letter = (bidder.user?.name || bidder.username || '#').charAt(0).toUpperCase()
            const lastGroup = groups[groups.length - 1]
            if (lastGroup && lastGroup.letter === letter) {
              lastGroup.bidders.push(bidder)
            } else {
              groups.push({ letter, bidders: [bidder] })
            }
          })
          return groups.map(group => (
            <div key={group.letter} className="mb-2 last:mb-0">
              <div className="text-[9px] font-black text-teal-400/80 uppercase tracking-widest mb-1 px-0.5">{group.letter}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {group.bidders.map(bidder => {
                  const isLeader = bidder.id === highestBidderId
                  const isSelected = bidder.id === selectedBidderId
                  return (
                    <button
                      key={bidder.id}
                      disabled={isLeader}
                      onClick={() => onSelectBidder(bidder.id)}
                      className={`text-left p-1.5 rounded-lg border flex items-center gap-1.5 min-w-0 ${
                        isLeader
                          ? 'bg-green-500/10 border-green-500/40 cursor-not-allowed'
                          : isSelected
                          ? 'bg-teal-500/15 border-teal-500'
                          : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${isLeader ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-gray-200'}`}>
                        {(bidder.user?.name || bidder.username || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className={`text-[10px] font-bold truncate ${isLeader ? 'text-green-300' : 'text-gray-100'}`}>{bidder.user?.name || bidder.username || 'Bidder'}</div>
                        {bidder.teamName && <div className="text-[9px] font-medium truncate text-gray-500">{bidder.teamName}</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        })()}
      </div>

      {/* Confirm bar */}
      <div className="p-2.5 border-t border-white/10 bg-[#0f141d] flex-shrink-0">
        {canConfirm && selectedBidder && (
          <div className="text-[11px] text-gray-400 text-center mb-1.5">
            Confirm <span className="text-teal-400 font-bold">₹{selectedAmount!.toLocaleString('en-IN')}</span> for{' '}
            <span className="text-white font-bold">{selectedBidder.user?.name || selectedBidder.username}</span>?
          </div>
        )}
        <Button
          className={`w-full h-11 font-bold ${canConfirm ? 'bg-teal-500 hover:bg-teal-600 text-gray-950' : 'bg-white/[0.06] text-gray-600'}`}
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {isPlacingBid ? 'Placing...' : 'Confirm Bid'}
        </Button>
      </div>
    </div>
  )
}

interface AdminAuctionViewProps {
  auction: Auction & {
    players: Player[]
    bidders: BidderWithUser[]
  }
  currentPlayer: Player | null
  stats: {
    total: number
    sold: number
    unsold: number
    remaining: number
  }
  bidHistory: BidHistoryEntry[]
  viewMode?: 'admin' | 'bidder'
}

export function AdminAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats, bidHistory: initialHistory, viewMode = 'admin' }: AdminAuctionViewProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  // True once a sale empties the pool (nothing AVAILABLE, nothing UNSOLD left
  // to recycle) - without this, the UI has no way to distinguish "waiting for
  // the next player" from "there is no next player," and just freezes on
  // whoever was sold last.
  const [poolExhausted, setPoolExhausted] = useState(false)
  const [currentBid, setCurrentBid] = useState<{ bidderId: string; amount: number; bidderName: string; teamName?: string } | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [bidHistory, setBidHistory] = useState<BidHistoryEntry[]>([])
  const [fullBidHistory, setFullBidHistory] = useState(initialHistory)
  const [highestBidderId, setHighestBidderId] = useState<string | null>(null)
  const [soldAnimation, setSoldAnimation] = useState(false)
  const [undoSaleDialogOpen, setUndoSaleDialogOpen] = useState(false)
  const [selectedBidderForBid, setSelectedBidderForBid] = useState<string | null>(null)
  const [customBidAmount, setCustomBidAmount] = useState('')
  const [showAllPlayerDetails, setShowAllPlayerDetails] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [bidHistoryModalOpen, setBidHistoryModalOpen] = useState(false)
  const [isMarkingSold, setIsMarkingSold] = useState(false)
  const [isMarkingUnsold, setIsMarkingUnsold] = useState(false)
  const [customBidModalOpen, setCustomBidModalOpen] = useState(false)
  const [players, setPlayers] = useState(auction.players)
  const [bidAmount, setBidAmount] = useState(0)
  const [isPlacingBid, setIsPlacingBid] = useState(false)
  const [placingBidFor, setPlacingBidFor] = useState<string | null>(null) // Track which bidder's bid is being placed
  // Fast bidding console: amount and bidder are picked independently, in either order
  const [consoleSelectedAmount, setConsoleSelectedAmount] = useState<number | null>(null)
  const [consoleSelectedBidderId, setConsoleSelectedBidderId] = useState<string | null>(null)
  const [consoleCustomInput, setConsoleCustomInput] = useState('')
  const [error, setError] = useState('')
  const [bidders, setBidders] = useState(auction.bidders)
  const [isBidConsoleOpen, setIsBidConsoleOpen] = useState(false)
  const [showPlayerReveal, setShowPlayerReveal] = useState(false)
  const [pendingPlayer, setPendingPlayer] = useState<Player | null>(null)
  const [showGoingLiveBanner, setShowGoingLiveBanner] = useState(false)
  const [previousAuctionStatus, setPreviousAuctionStatus] = useState(auction.status)
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const soldAnimationRef = useRef(false)
  const showPlayerRevealRef = useRef(false)
  const pendingPlayerRef = useRef<Player | null>(null)
  const goingLiveBannerTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isDesktop, setIsDesktop] = useState(false)
  const showPinnedConsole = viewMode === 'admin' && isDesktop
  const errorIdRef = useRef(0)
  const bidErrorTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bidErrors, setBidErrors] = useState<Array<{ id: number; message: string }>>([])
  const pushBidError = useCallback((message: string) => {
    toast.error(message)
    const id = ++errorIdRef.current
    setBidErrors(prev => [{ id, message }, ...prev])
    const timeout = setTimeout(() => {
      setBidErrors(prev => prev.filter(err => err.id !== id))
      delete bidErrorTimeouts.current[id]
    }, 10000) // Changed from 2000ms to 10000ms (10 seconds)
    bidErrorTimeouts.current[id] = timeout
  }, [])
  const showBidError = useCallback((message: string) => {
    setError(message)
    pushBidError(message)
  }, [pushBidError])
  const canToggleConsole = !showPinnedConsole

  // Alphabetical by display name, not by purse - the console's job is
  // "find this specific bidder fast while the room is calling out names",
  // which a name-sorted (and letter-grouped, see BidConsolePanel) list
  // serves; purse ranking doesn't help you locate someone by name.
  const sortedBidders = useMemo(() =>
    bidders.slice().sort((a, b) =>
      (a.user?.name || a.username).localeCompare(b.user?.name || b.username)
    ),
    [bidders]
  )
  
  // Fast bidding console: confirm the amount+bidder the admin has picked.
  // Reuses the exact optimistic-update + rollback pattern the old per-bidder
  // "Raise" button used, just parameterized by whatever was selected instead
  // of a fixed increment on a specific card.
  const confirmConsoleBid = useCallback(() => {
    if (!consoleSelectedBidderId || consoleSelectedAmount == null) return
    if (isPlacingBid || placingBidFor === consoleSelectedBidderId) return

    const bidder = sortedBidders.find(b => b.id === consoleSelectedBidderId)
    if (!bidder) return
    const totalBid = consoleSelectedAmount

    const previousBid = currentBid
    const previousHighestBidderId = highestBidderId

    const optimisticEntryId = `optimistic-${Date.now()}-${Math.random()}`
    const optimisticEntry: BidHistoryEntry = {
      bidderId: bidder.id,
      amount: totalBid,
      timestamp: new Date(),
      bidderName: bidder.user?.name || bidder.username,
      teamName: bidder.teamName || undefined,
      type: 'bid',
      playerId: currentPlayer?.id,
      _optimisticId: optimisticEntryId
    } as any

    setIsPlacingBid(true)
    setPlacingBidFor(bidder.id)
    setCurrentBid({
      bidderId: bidder.id,
      amount: totalBid,
      bidderName: bidder.user?.name || bidder.username,
      teamName: bidder.teamName || undefined
    })
    setHighestBidderId(bidder.id)
    setFullBidHistory(prev => [optimisticEntry, ...prev])
    // Reset the console immediately so it's ready for the next call-out
    setConsoleSelectedAmount(null)
    setConsoleSelectedBidderId(null)
    setConsoleCustomInput('')

    fetch(`/api/auction/${auction.id}/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidderId: bidder.id, amount: totalBid })
    })
      .then(async (response) => {
        if (!response.ok) {
          const err = await response.json()
          pushBidError(err.error || 'Failed to place bid')
          setCurrentBid(previousBid)
          setHighestBidderId(previousHighestBidderId)
          setFullBidHistory(prev => prev.filter(entry =>
            (entry as any)._optimisticId !== optimisticEntryId
          ))
        }
      })
      .catch(() => {
        pushBidError('Network error')
        setCurrentBid(previousBid)
        setHighestBidderId(previousHighestBidderId)
        setFullBidHistory(prev => prev.filter(entry =>
          (entry as any)._optimisticId !== optimisticEntryId
        ))
      })
      .finally(() => {
        startTransition(() => {
          setIsPlacingBid(false)
          setPlacingBidFor(null)
        })
      })
  }, [consoleSelectedBidderId, consoleSelectedAmount, isPlacingBid, placingBidFor, sortedBidders, currentBid, highestBidderId, auction, currentPlayer, pushBidError])

  // Picking an amount (chip tap or clear) always also resets any typed text,
  // since the two represent the same underlying selection.
  const handleConsoleSelectAmount = useCallback((amount: number | null) => {
    setConsoleSelectedAmount(amount)
    setConsoleCustomInput('')
  }, [])

  const handleConsoleCustomInput = useCallback((raw: string) => {
    const digitsOnly = raw.replace(/[^0-9]/g, '')
    setConsoleCustomInput(digitsOnly)
    setConsoleSelectedAmount(digitsOnly ? parseInt(digitsOnly, 10) : null)
  }, [])

  // Keep refs in sync with state
  useEffect(() => {
    soldAnimationRef.current = soldAnimation
  }, [soldAnimation])
  
  useEffect(() => {
    showPlayerRevealRef.current = showPlayerReveal
  }, [showPlayerReveal])
  
  useEffect(() => {
    pendingPlayerRef.current = pendingPlayer
  }, [pendingPlayer])

  useEffect(() => {
    const updateDeviceType = () => {
      if (typeof window !== 'undefined') {
        setIsDesktop(window.innerWidth >= 1024)
      }
    }
    updateDeviceType()
    window.addEventListener('resize', updateDeviceType)
    return () => window.removeEventListener('resize', updateDeviceType)
  }, [])

  useEffect(() => {
    if (showPinnedConsole && isBidConsoleOpen) {
      setIsBidConsoleOpen(false)
    }
  }, [showPinnedConsole, isBidConsoleOpen])

  useEffect(() => {
    return () => {
      Object.values(bidErrorTimeouts.current).forEach(clearTimeout)
    }
  }, [])

  // Find current user's bidder profile (for bidder view)
  const userBidder = bidders.find((b) => b.userId === session?.user?.id)
  
  // Calculate if userBidder has reached max team size
  const isTeamFull = useMemo(() => {
    if (!userBidder) return false
    const rules = auction.rules as any
    // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (if available)
    const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
    if (!maxTeamSize) {
      console.log('[Team Full Check] No maxTeamSize or mandatoryTeamSize set in rules - team size limit not enforced')
      return false
    }
    
    // Count players bought by this bidder - use ALL players, not just current state
    const playersBought = players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
    
    // Team size includes the bidder, so if they've bought (maxTeamSize - 1) players, team is full
    const isFull = playersBought >= maxTeamSize - 1
    
    // Log only when team becomes full or when current player changes
    if (isFull || currentPlayer) {
      console.log('[Team Full Check]', {
        bidderId: userBidder.id,
        bidderName: userBidder.user?.name || userBidder.teamName || userBidder.username,
        playersBought,
        maxTeamSize,
        maxPlayersCanBuy: maxTeamSize - 1,
        isFull,
        usingMandatoryTeamSize: !rules?.maxTeamSize && !!rules?.mandatoryTeamSize,
        currentPlayerName: currentPlayer ? ((currentPlayer.data as any)?.Name || (currentPlayer.data as any)?.name) : 'none',
        allPlayers: players.length,
        soldPlayers: players.filter(p => p.status === 'SOLD').length
      })
    }
    
    return isFull
  }, [userBidder, players, auction.rules, currentPlayer])
  
  // Open custom bid modal when bidder is selected (for admin view)
  useEffect(() => {
    if (selectedBidderForBid) {
      setCustomBidModalOpen(true)
    }
  }, [selectedBidderForBid])

  // Refresh auction state from server  
  const refreshAuctionState = useCallback(async () => {
    try {
      // Fetch updated auction data
      const response = await fetch(`/api/auctions/${auction.id}`)
      const data = await response.json()
      
      if (data.auction?.bidHistory && Array.isArray(data.auction.bidHistory)) {
        // Update full bid history - the useEffect will filter it for current player
        setFullBidHistory(data.auction.bidHistory)
      }
      
      // Also update bidders to ensure balance is current
      if (data.auction?.bidders) {
        console.log('🔄 Refreshing bidders balance from server')
        setBidders(data.auction.bidders)
      }
    } catch (error) {
      console.error('Failed to refresh auction state:', error)
    }
  }, [auction.id])

  // Refresh players list from server
  const refreshPlayersList = useCallback(async () => {
    try {
      const response = await fetch(`/api/auctions/${auction.id}`)
      const data = await response.json()
      if (data.auction?.players) {
        setPlayers(data.auction.players)
      }
      if (data.auction?.bidders) {
        setBidders(data.auction.bidders)
      }
    } catch (error) {
      console.error('Failed to refresh players list:', error)
    }
  }, [auction.id])

  // Set client-side rendered flag
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Mirror a lightweight snapshot to this device's local storage on every
  // change - the safety net the offline fallback page (/auction/[id]/offline)
  // reads from if the app itself becomes unreachable. Best-effort only: it
  // must never be able to break the live console if storage is unavailable
  // (private browsing, quota), which is why the store helper swallows its
  // own errors rather than throwing here.
  //
  // Includes currentPlayerId/currentBid (whoever was actually on the block
  // and winning, right now) and rules (the bidding constraints) - without
  // these, an outage mid-sale would strand that in-progress player and the
  // offline console would have no way to enforce the same purse/team-size
  // rules the live server does.
  useEffect(() => {
    saveOfflineSnapshot({
      auctionId: auction.id,
      auctionName: auction.name,
      savedAt: new Date().toISOString(),
      players: players.map(p => ({
        id: p.id,
        data: p.data as Record<string, unknown>,
        status: p.status,
        isIcon: p.isIcon,
        soldTo: p.soldTo ?? null,
        soldPrice: p.soldPrice ?? null
      })),
      bidders: bidders.map(b => ({
        id: b.id,
        username: b.username,
        teamName: b.teamName ?? null,
        name: b.user?.name ?? null,
        remainingPurse: b.remainingPurse
      })),
      currentPlayerId: currentPlayer?.id ?? null,
      currentBid: currentBid
        ? {
            bidderId: currentBid.bidderId,
            amount: currentBid.amount,
            bidderName: currentBid.bidderName,
            teamName: currentBid.teamName ?? null
          }
        : null,
      rules: (auction.rules as Record<string, unknown>) ?? null
    })
  }, [auction.id, auction.name, auction.rules, players, bidders, currentPlayer, currentBid])

  // Warm this browser's own HTTP cache with every player's photo, once,
  // so the offline fallback console - which can only ever show a photo
  // this exact browser has already fetched, since it makes zero network
  // calls of its own (see offline/page.tsx) - isn't missing one just
  // because that particular player hasn't come up live yet. proxy-image
  // already marks these immutable for a year, so once fetched they cost
  // nothing again regardless of how many times any page asks for them.
  //
  // Deliberately admin-only and one-time per mount: a bidder or public
  // viewer only ever needs the one player currently on screen (already
  // cached + coalesced for them via proxy-image), so eagerly fetching the
  // whole roster for every viewer would burn their bandwidth on photos
  // they were never going to need - this is purely an offline-reliability
  // measure for whichever browser might have to run that console, not a
  // general caching change for the live auction.
  const imagePrefetchStartedRef = useRef(false)
  useEffect(() => {
    if (viewMode !== 'admin' || imagePrefetchStartedRef.current || players.length === 0) return
    imagePrefetchStartedRef.current = true

    const urls = players
      .map(p => extractPlayerImageUrl(p.data as Record<string, unknown>))
      .filter((url): url is string => !!url)

    let cancelled = false
    const CONCURRENCY = 4
    let nextIndex = 0

    const fetchNext = () => {
      if (cancelled || nextIndex >= urls.length) return
      const url = urls[nextIndex]
      nextIndex += 1
      const img = new Image()
      img.onload = fetchNext
      img.onerror = fetchNext
      img.src = url
    }

    for (let i = 0; i < CONCURRENCY; i++) fetchNext()

    return () => { cancelled = true }
  }, [viewMode, players])

  // Detect when auction goes live and show banner
  useEffect(() => {
    // Check if auction status changed from DRAFT/PAUSED to LIVE/MOCK_RUN
    const wasNotLive = !isLiveStatus(previousAuctionStatus)
    const isNowLive = isLiveStatus(auction.status)
    const hasCurrentPlayer = currentPlayer !== null

    if (wasNotLive && isNowLive && hasCurrentPlayer) {
      console.log('🎬 Auction just went LIVE - showing going live banner')
      setShowGoingLiveBanner(true)
      
      // Clear any existing timeout
      if (goingLiveBannerTimeoutRef.current) {
        clearTimeout(goingLiveBannerTimeoutRef.current)
      }
      
      // Hide banner after 4 seconds
      goingLiveBannerTimeoutRef.current = setTimeout(() => {
        setShowGoingLiveBanner(false)
        goingLiveBannerTimeoutRef.current = null
      }, 4000)
    }

    // Update previous status
    setPreviousAuctionStatus(auction.status)

    // Cleanup timeout on unmount
    return () => {
      if (goingLiveBannerTimeoutRef.current) {
        clearTimeout(goingLiveBannerTimeoutRef.current)
      }
    }
  }, [auction.status, currentPlayer, previousAuctionStatus])

  // Memoize player bid history for performance
  const playerBidHistory = useMemo(() => {
    if (!currentPlayer?.id) return []
    // Filter bids to only include those for the current player
    const filteredBids = fullBidHistory.filter(bid => {
      // Filter out stale "bid-undo" entries (they should only exist in real-time, not in DB)
      if (bid.type === 'bid-undo') return false
      // Only include bids that have playerId matching current player
      return bid.playerId === currentPlayer.id
    })
    // Keep latest first (no reverse needed since fullBidHistory adds new bids at beginning)
    return filteredBids
  }, [currentPlayer?.id, fullBidHistory])

  // Filter bid history for current player whenever player changes
  useEffect(() => {
    if (currentPlayer?.id) {
      // Filter out non-bid entries (sold, unsold, sale-undo, bid-undo) for display
      const displayBidHistory = playerBidHistory.filter(bid => 
        !bid.type || bid.type === 'bid'
      )
      setBidHistory(displayBidHistory)
      
      // Get the most recent bid (first item, since latest is first)
      // Only consider actual bid entries, not sold/unsold/sale-undo
      const latestBid = displayBidHistory.length > 0 ? displayBidHistory[0] : null
      
      // Update current bid to the latest bid (only if it's a bid event)
      if (latestBid && latestBid.amount && latestBid.bidderId && latestBid.bidderName) {
        // Get actual bidder name from bidders array to ensure we use name, not username
        const actualBidder = bidders.find(b => b.id === latestBid.bidderId)
        const actualBidderName = actualBidder?.user?.name || latestBid.bidderName || 'Bidder'
        const actualTeamName = actualBidder?.teamName || latestBid.teamName
        
        setCurrentBid({
          bidderId: latestBid.bidderId,
          amount: latestBid.amount,
          bidderName: actualBidderName,
          teamName: actualTeamName
        })
        setHighestBidderId(latestBid.bidderId)
      } else {
        // No valid bids, clear current bid
        setCurrentBid(null)
        setHighestBidderId(null)
      }
    } else {
      setBidHistory([])
      setCurrentBid(null)
      setHighestBidderId(null)
    }
  }, [currentPlayer?.id, playerBidHistory, bidders])

  // Reset image loading when player changes (but not on initial load)
  useEffect(() => {
    if (currentPlayer?.id && initialPlayer?.id && currentPlayer.id !== initialPlayer.id) {
      setIsImageLoading(true)
    }
  }, [currentPlayer?.id, initialPlayer?.id])

  // Memoize callbacks to prevent re-subscription
  const handleNewBid = useCallback((data: PusherBidData) => {
      // Clear bid placement state when Pusher confirms the bid (fallback if API didn't clear it)
      setIsPlacingBid(false)
      setPlacingBidFor(null)
      
      // Remove any optimistic entries for this bidder and player before adding server-confirmed bid
      // This ensures we don't have duplicate entries
      setFullBidHistory(prev => {
        // Remove optimistic entries for the same bidder and player
        const filtered = prev.filter(entry => 
          !((entry as any)._optimisticId && 
            entry.bidderId === data.bidderId && 
            entry.playerId === currentPlayer?.id)
        )
        return filtered
      })
      
      // Update state from Pusher (this is the source of truth, corrects any API response discrepancies)
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId) // Update from server-confirmed data
      
      // Add new bid to full history (single source of truth)
      const newBidEntry = {
        type: 'bid' as const,
        bidderId: data.bidderId,
        amount: data.amount,
        timestamp: new Date(),
        bidderName: data.bidderName,
        teamName: data.teamName,
        playerId: currentPlayer?.id // Associate bid with current player
      }
      setFullBidHistory(prev => {
        const last = prev[0]
        // If the last entry matches (optimistic entry), replace it with server-confirmed data
        if (last && last.type === 'bid' && last.playerId === newBidEntry.playerId && last.bidderId === newBidEntry.bidderId && last.amount === newBidEntry.amount) {
          // Replace optimistic entry with server-confirmed entry
          return [newBidEntry, ...prev.slice(1)]
        }
        return [newBidEntry, ...prev]
      })
      
      // Update purse instantly from Pusher data (no API call needed)
      if (data.remainingPurse !== undefined) {
        setBidders(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
      
      // Clear selected bidder after successful bid
      setSelectedBidderForBid(null)
      setCustomBidAmount('')
  }, [currentPlayer?.id])

  const handleBidUndo = useCallback((data: PusherBidUndoData) => {
      console.log('🔄 handleBidUndo triggered with data:', data)
      
      // Clear bid placement state when bid is undone
      setIsPlacingBid(false)
      setPlacingBidFor(null)
      
      // Update bid history in real-time: remove the undone bid and add "BID UNDONE" entry
      setBidHistory(prev => {
        if (prev.length === 0) {
          console.log('No bid history to undo')
          return prev
        }

        // Find the first ACTUAL bid (skip bid-undo entries at the top)
        const firstBidIndex = prev.findIndex(entry => !entry.type || entry.type === 'bid')
        
        if (firstBidIndex === -1) {
          console.log('Cannot undo: no actual bids found in history')
          return prev
        }
        
        const undoneBid = prev[firstBidIndex]
        console.log('Undoing bid at index', firstBidIndex, undoneBid)
        
        // Remove the undone bid from history
        const withoutUndone = prev.filter((_, index) => index !== firstBidIndex)

        // Get actual bidder name from bidders array (not from history entry which might have username)
        const actualBidder = bidders.find(b => b.id === undoneBid.bidderId)
        const actualBidderName = actualBidder?.user?.name || undoneBid.bidderName || 'Bidder'
        const actualTeamName = actualBidder?.teamName || undoneBid.teamName

        // Add visible "BID UNDONE" entry at the beginning
        return [{
          bidderId: undoneBid.bidderId,
          amount: undoneBid.amount,
          timestamp: new Date(),
          bidderName: actualBidderName,
          teamName: actualTeamName,
          type: 'bid-undo' as const,
          playerId: undoneBid.playerId
        }, ...withoutUndone]
      })
      
      // Update current bid - validate bidderName from bidders array
      if (data.currentBid && data.currentBid.amount > 0) {
        console.log('Setting current bid to:', data.currentBid)
        // Get actual bidder name from bidders array to ensure we use name, not username
        const currentBid = data.currentBid // Store in local variable for TypeScript
        const actualBidder = bidders.find(b => b.id === currentBid.bidderId)
        const actualBidderName = actualBidder?.user?.name || currentBid.bidderName || 'Bidder'
        const actualTeamName = actualBidder?.teamName || currentBid.teamName
        
        setCurrentBid({
          bidderId: currentBid.bidderId,
          amount: currentBid.amount,
          bidderName: actualBidderName,
          teamName: actualTeamName
        })
        setHighestBidderId(currentBid.bidderId)
      } else {
        console.log('Clearing current bid (no previous bid)')
        setCurrentBid(null)
        setHighestBidderId(null)
      }
      
      // Update purse instantly from Pusher data if available
      if (data.remainingPurse !== undefined && data.bidderId) {
        console.log('Updating purse for bidder:', data.bidderId, 'to:', data.remainingPurse)
        setBidders(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
      
      console.log('✅ handleBidUndo completed')
  }, [bidders])

  const handleSaleUndo = useCallback((data: PusherSaleUndoData) => {
      console.log('🔄 Sale undo event received:', data)
      // Undoing a sale always brings a player back onto the block, so
      // whatever "pool exhausted" state existed no longer applies.
      setPoolExhausted(false)

      // Update player status if player data is provided
      if (data.player) {
        setPlayers(prev => prev.map(p => 
          p.id === data.playerId ? data.player : p
        ))
        
        // When a sale is undone, the API sets this player as currentPlayerId
        // So we should update the current player to this undone player
        setCurrentPlayer(data.player)
      } else {
        // Fallback: update player status to AVAILABLE
        setPlayers(prev => {
          const updated = prev.map(p => 
            p.id === data.playerId 
              ? { ...p, status: 'AVAILABLE' as const, soldTo: null, soldPrice: null }
              : p
          )
          
          // Find the undone player and set it as current
          const undonePlayer = updated.find(p => p.id === data.playerId)
          if (undonePlayer) {
            setCurrentPlayer({
              ...undonePlayer,
              status: 'AVAILABLE' as const,
              soldTo: null,
              soldPrice: null
            })
          }
          
          return updated
        })
      }
      
      const isUnsoldUndo = data.undoneType === 'unsold'

      // An unsold-undo never involved a bidder or purse - only a sold-undo
      // needs this.
      if (!isUnsoldUndo) {
        if (data.bidderRemainingPurse !== undefined && data.bidderId) {
          setBidders(prev => prev.map(b =>
            b.id === data.bidderId
              ? { ...b, remainingPurse: data.bidderRemainingPurse! }
              : b
          ))
        } else if (data.updatedBidders) {
          // Batch update multiple bidders
          setBidders(prev => prev.map(b => {
            const update = data.updatedBidders!.find(ub => ub.id === b.id)
            return update ? { ...b, remainingPurse: update.remainingPurse } : b
          }))
        }
      }

      // Reset current bid and highest bidder since the player is back to being available
      setCurrentBid(null)
      setHighestBidderId(null)

      // Remove only the reverted event (sold or unsold) for this player -
      // keep all bids, which should only be removed via "undo bid".
      const revertedType = isUnsoldUndo ? 'unsold' : 'sold'
      const playerData = data.player?.data as any
      const playerName = playerData?.Name || playerData?.name || 'Player'
      const undoEvent: BidHistoryEntry = {
        type: 'sale-undo' as const,
        playerId: data.playerId,
        playerName: playerName,
        timestamp: new Date(),
        refundedAmount: isUnsoldUndo ? undefined : data.refundedAmount
      }
      setFullBidHistory(prev => {
        const filtered = prev.filter(entry =>
          !(entry.playerId === data.player.id && entry.type === revertedType)
        )
        // Add the undo event at the beginning
        return [undoEvent, ...filtered]
      })

      // Update bid history to show remaining bids for this player
      // Filter to only show bids for current player (excluding sold/unsold events)
      setBidHistory(prev => {
        return prev.filter(entry =>
          entry.playerId === data.player.id &&
          entry.type !== 'sold' &&
          entry.type !== 'unsold'
        )
      })

      // Show success toast
      if (isUnsoldUndo) {
        toast.success(`Unsold undone! ${playerName} is back on the block.`)
      } else {
        toast.success(`Sale undone! Player restored and ₹${data.refundedAmount?.toLocaleString('en-IN') || 'amount'} refunded`)
      }
  }, [])

  const handlePlayerSold = useCallback((data: PusherSoldData) => {
      setSoldAnimation(true)
      setTimeout(() => {
        setSoldAnimation(false)
        // Don't auto-advance - let admin control it manually
      }, 3000)
    
    // Add sold event to bid history
    if (data && currentPlayer) {
      const soldEvent = {
        type: 'sold' as const,
        playerId: currentPlayer.id,
        playerName: data.playerName || 'Unknown',
        bidderId: data.bidderId,
        amount: data.amount || 0,
        timestamp: new Date(),
        bidderName: data.bidderName || '',
        teamName: data.teamName
      }
      setFullBidHistory(prev => [soldEvent, ...prev])
    }
    
    // Update purse instantly from Pusher data (no API call needed)
    if (data.bidderRemainingPurse !== undefined && data.bidderId) {
      setBidders(prev => prev.map(b => 
        b.id === data.bidderId 
          ? { ...b, remainingPurse: data.bidderRemainingPurse! }
          : b
      ))
    } else if (data.updatedBidders) {
      // Batch update multiple bidders
      setBidders(prev => prev.map(b => {
        const update = data.updatedBidders!.find(ub => ub.id === b.id)
        return update ? { ...b, remainingPurse: update.remainingPurse } : b
      }))
    }
    
    // Update player status instantly - update ALL players, not just current
    setPlayers(prev => prev.map(p => 
      p.id === data.playerId 
        ? { ...p, status: 'SOLD' as const, soldTo: data.bidderId, soldPrice: data.amount }
        : p
    ))
  }, [])

  const handleNewPlayer = useCallback((data: PusherPlayerData) => {
      setPoolExhausted(false)
      console.log('🎬 NEW PLAYER EVENT RECEIVED - Starting reveal animation:', data.player)
      console.log('🎬 Player data:', {
        id: data.player?.id,
        name: (data.player?.data as any)?.Name || (data.player?.data as any)?.name,
        status: data.player?.status
      })
      
      // Clear any pending fallback timeout since Pusher event arrived
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
        fallbackTimeoutRef.current = null
        console.log('✅ Cleared fallback timeout - Pusher event received')
      }
      
      // Store the new player
      setPendingPlayer(data.player)
      pendingPlayerRef.current = data.player
      
      console.log('🎬 handleNewPlayer called (from Pusher):', {
        hasPlayer: !!data.player,
        playerName: (data.player?.data as any)?.Name || (data.player?.data as any)?.name,
        showPlayerReveal: showPlayerRevealRef.current,
        hasPendingPlayer: !!pendingPlayerRef.current
      })
      
      // If animation is already showing (triggered from handleMarkSold/handleMarkUnsold),
      // just update the pending player - don't restart the animation
      if (showPlayerRevealRef.current) {
        console.log('🎬 Animation already running, just updating pending player')
        // Animation is already running, just ensure pending player is updated
        // The animation will use the updated pendingPlayer
        return
      }
      
      // If animation is not showing yet, start it
      // Check if sold animation is showing - if so, delay reveal animation until after it closes
      if (soldAnimationRef.current) {
        console.log('⏳ Sold animation is showing, delaying reveal animation by 3s')
        setTimeout(() => {
          console.log('🎬 Delayed reveal animation starting now (from Pusher)')
          setShowPlayerReveal(true)
        }, 3000)
      } else {
        // Show reveal animation immediately if sold animation is not showing
        console.log('🎬 No sold animation, starting reveal animation immediately (from Pusher)')
        setShowPlayerReveal(true)
      }
      
      // Don't update current player yet - wait for animation to complete
  }, [])

  // Handler when reveal animation completes
  const handleRevealComplete = useCallback(() => {
      console.log('✅ REVEAL ANIMATION COMPLETE - Updating player')
      
      // Clear any pending fallback timeout since animation completed
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
        fallbackTimeoutRef.current = null
      }
      
      // Use ref to get latest pendingPlayer value (closure issue fix)
      const latestPendingPlayer = pendingPlayerRef.current
      
      if (latestPendingPlayer) {
        console.log('✅ Setting current player from pending player:', latestPendingPlayer)
        console.log('✅ Player data:', latestPendingPlayer.data)
        console.log('✅ Player name:', (latestPendingPlayer.data as any)?.Name || (latestPendingPlayer.data as any)?.name)
        
        // Hide animation first
        setShowPlayerReveal(false)
        
        // Set all state updates together - React 18 batches these automatically
        setIsImageLoading(true)
        setCurrentPlayer(latestPendingPlayer) // Set player FIRST
        setBidHistory([]) // Clear bid history for new player
        setCurrentBid(null) // Clear current bid
        setHighestBidderId(null) // Clear highest bidder
        setSelectedBidderForBid(null) // Clear selected bidder
        setCustomBidAmount('') // Clear custom bid amount
        setBidAmount(0) // Clear bid amount for bidder
        // Clear loading states
        setIsMarkingSold(false)
        setIsMarkingUnsold(false)
        
        // Check team size when new player loads - use setTimeout to ensure players state is updated
        if (userBidder) {
          setTimeout(() => {
            const rules = auction.rules as any
            // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
            const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
            if (maxTeamSize) {
              // Access players state via a function to get latest value
              setPlayers(currentPlayers => {
                const playersBought = currentPlayers.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
                const isFull = playersBought >= maxTeamSize - 1
                console.log('[New Player Loaded] Team size check:', {
                  bidderId: userBidder.id,
                  bidderName: userBidder.user?.name || userBidder.teamName || userBidder.username,
                  playersBought,
                  maxTeamSize,
                  maxPlayersCanBuy: maxTeamSize - 1,
                  isFull,
                  newPlayerName: (latestPendingPlayer.data as any)?.Name || (latestPendingPlayer.data as any)?.name
                })
                return currentPlayers // Return unchanged to not modify state
              })
            }
          }, 200) // Delay to ensure players state is updated from Pusher
        }
        
        // Use setTimeout to ensure currentPlayer state update completes before clearing pending
        // This ensures the player card renders with the new player
        setTimeout(() => {
          // Clear pending player AFTER current player is set
          setPendingPlayer(null)
          pendingPlayerRef.current = null
        }, 0)
        
        // Refresh full bid history from server when new player loads
        refreshAuctionState()
      } else {
        console.warn('⚠️ No pending player found when animation completed')
        // Still hide animation even if no pending player
        setShowPlayerReveal(false)
      }
  }, [refreshAuctionState, userBidder, auction.rules])

  const handleAuctionPaused = useCallback(() => setIsPaused(true), [])
  const handleAuctionResumed = useCallback(() => setIsPaused(false), [])
  const handlePlayersUpdated = useCallback((data: { players?: any[]; bidders?: Array<{ id: string; remainingPurse: number }> }) => {
      // Update from Pusher data if available (no API call needed)
      if (data.players) {
        setPlayers(prev => {
          const updated = [...prev]
          data.players!.forEach(player => {
            const index = updated.findIndex(p => p.id === player.id)
            if (index >= 0) {
              // Merge rather than replace - the broadcast only carries the
              // fields that changed, not the full player record, to keep
              // the Pusher payload small.
              updated[index] = { ...updated[index], ...player }
            } else {
              // A genuinely unseen player would need its full record
              // (data/isIcon/etc.), which this partial broadcast doesn't
              // carry - skip rather than push a broken row. In practice
              // every player this event names was already loaded on mount.
              console.warn('[players-updated] Received update for unknown player, ignoring:', player.id)
            }
          })
          return updated
        })
        
        // Log team size check after players are updated
        if (userBidder) {
          const rules = auction.rules as any
          // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
          const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
          if (maxTeamSize) {
            // Use the updated players from data, not prev state
            const playersBought = data.players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
            const isFull = playersBought >= maxTeamSize - 1
            console.log('[Players Updated] Team size check:', {
              bidderId: userBidder.id,
              bidderName: userBidder.user?.name || userBidder.teamName || userBidder.username,
              playersBought,
              maxTeamSize,
              maxPlayersCanBuy: maxTeamSize - 1,
              isFull
            })
          }
        }
      }
      
      if (data.bidders) {
        setBidders(prev => prev.map(b => {
          const update = data.bidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
  }, [userBidder, auction.rules])

  const handleAuctionReset = useCallback(() => {
      toast.success('Auction has been reset! Reloading page...')
      // Use router.refresh() to reload data without full page reload
      setTimeout(() => {
        router.refresh()
      }, 1000)
  }, [router])

  const handleAuctionEnded = useCallback(() => {
      toast.success('Auction ended successfully! Redirecting to results...')
      setTimeout(() => {
        // Redirect to the auction page which will show results view
        window.location.href = `/auction/${auction.id}`
      }, 1000)
  }, [auction.id])

  // Real-time subscriptions
  usePusher(auction.id, {
    onNewBid: handleNewBid,
    onBidUndo: handleBidUndo,
    onSaleUndo: handleSaleUndo,
    onPlayerSold: handlePlayerSold,
    onNewPlayer: handleNewPlayer,
    onAuctionPaused: handleAuctionPaused,
    onAuctionResumed: handleAuctionResumed,
    onPlayersUpdated: handlePlayersUpdated,
    onAuctionEnded: handleAuctionEnded,
    onAuctionReset: handleAuctionReset,
    onAuctionPoolExhausted: () => setPoolExhausted(true),
  })

  // Bid errors arrive on a separate admin-only channel - see useAdminPusher.
  useAdminPusher(auction.id, {
    onBidError: (data) => {
      pushBidError(data.message)
    },
  })

  // Proactive connectivity check - independent of Pusher and of whatever the
  // admin is doing, so an outage is detected before an action ever fails.
  // The local snapshot below already mirrors continuously, so the moment
  // this flips, the offline console (which reads that snapshot) is ready
  // with current data, not whatever was last saved before the tab was
  // originally opened.
  const { isOnline } = useConnectivityBeacon(auction.id)

  // Warm Next's client router cache for the offline console route while
  // still reachable, not only once the red banner below appears offering
  // it - by then the network is already down, so there's nothing left to
  // fetch. This is the difference between "Switch to Offline Console"
  // navigating instantly within this already-open tab during a real
  // outage, and it silently trying (and failing) to fetch a page from a
  // server this device can no longer reach. It does NOT help opening the
  // console fresh in a brand new tab or after a hard refresh - that still
  // needs the tab to have been loaded at least once before the outage,
  // same as the console's own operational guidance already says.
  useEffect(() => {
    if (viewMode === 'admin') {
      router.prefetch(`/auction/${auction.id}/offline`)
    }
  }, [viewMode, auction.id, router])

  const handleStartAuction = async () => {
    await fetch(`/api/auction/${auction.id}/start`, { method: 'POST' })
  }

  const handlePauseResume = async () => {
    if (isPaused) {
      await fetch(`/api/auction/${auction.id}/resume`, { method: 'POST' })
    } else {
      await fetch(`/api/auction/${auction.id}/pause`, { method: 'POST' })
    }
    setIsPaused(!isPaused)
  }

  const handleNextPlayer = async () => {
    try {
      const response = await fetch(`/api/auction/${auction.id}/next-player`, { method: 'POST' })
      if (!response.ok) {
        console.error('Failed to move to next player')
      }
    } catch (error) {
      console.error('Error moving to next player:', error)
    }
  }

  const handleEndAuction = async () => {
    await fetch(`/api/auction/${auction.id}/end`, { method: 'POST' })
  }

  const handleResetAuction = async () => {
    if (!confirm('Are you sure you want to reset the auction? This will:\n- Reset all players to AVAILABLE\n- Reset all bidders\' purses to original amounts\n- Clear all bid history\n- Set auction status to DRAFT\n\nThis action cannot be undone!')) {
      return
    }
    
    try {
      const response = await fetch(`/api/auction/${auction.id}/reset`, { method: 'POST' })
      if (response.ok) {
        toast.success('Auction reset successfully')
        // Use router.refresh() to reload data without full page reload
        // This avoids React context issues that occur with window.location.reload()
        setTimeout(() => {
          router.refresh()
        }, 500)
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to reset auction')
      }
    } catch (error) {
      console.error('Error resetting auction:', error)
      toast.error('Failed to reset auction')
    }
  }

  const handleMarkSold = async () => {
    if (!currentPlayer || !currentBid) return

    // Set loading state - but DON'T show sold animation until API confirms success
    setIsMarkingSold(true)
    
    // API call - wait for success before showing animation
    fetch(`/api/auction/${auction.id}/mark-sold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          toast.success('Player marked as sold!')
          
          // Only show sold animation AFTER API confirms success
          // The Pusher event will also trigger handlePlayerSold which shows the animation,
          // but we show it here too in case Pusher is delayed
          setSoldAnimation(true)
          
          // Trigger reveal animation immediately if we have next player
          if (data.nextPlayer) {
            console.log('🎬 Setting pending player from mark-sold response:', data.nextPlayer)
            setPendingPlayer(data.nextPlayer)
            pendingPlayerRef.current = data.nextPlayer
            
            // Clear any existing fallback timeout
            if (fallbackTimeoutRef.current) {
              clearTimeout(fallbackTimeoutRef.current)
              fallbackTimeoutRef.current = null
            }
            
            // Start reveal animation after sold animation closes (3 seconds)
            setTimeout(() => {
              console.log('🎬 Starting reveal animation after sold banner closed')
              setShowPlayerReveal(true)
            }, 3000)
            
            // Set a timeout fallback in case animation doesn't complete
            // Increased timeout to 12 seconds (3s sold + 5s reveal + 1.5s buffer + 2.5s extra safety)
            fallbackTimeoutRef.current = setTimeout(() => {
              console.warn('⚠️ Animation fallback triggered - setting player directly')
              const fallbackPlayer = pendingPlayerRef.current || data.nextPlayer
              if (fallbackPlayer) {
                setCurrentPlayer(fallbackPlayer)
                setCurrentBid(null)
                setBidHistory([])
                setHighestBidderId(null)
                setIsMarkingSold(false)
                setShowPlayerReveal(false)
                setPendingPlayer(null)
                pendingPlayerRef.current = null
                refreshAuctionState()
              }
              fallbackTimeoutRef.current = null
            }, 12000)
          } else {
            // No next player in the response - the pool is empty. Show that
            // clearly now instead of waiting on the 'auction-pool-exhausted'
            // Pusher round-trip, which the admin who just took this action
            // shouldn't have to wait on to see the result of their own click.
            setPoolExhausted(true)
          }

          // Auto-hide sold animation after 3 seconds (Pusher event will also handle this)
          setTimeout(() => {
            setSoldAnimation(false)
            setCurrentBid(null)
            setBidHistory([])
            setHighestBidderId(null)
          }, 3000)
        } else {
          // API call failed - show error and don't show sold animation
          const errorData = await response.json()
          toast.error(errorData.error || 'Failed to mark as sold')
          setIsMarkingSold(false)
          // Don't set soldAnimation here - it was never shown
        }
      })
      .catch(() => {
        // Network error - show error and don't show sold animation
        toast.error('Network error')
        setIsMarkingSold(false)
        // Don't set soldAnimation here - it was never shown
      })
  }

  const handleMarkUnsold = async () => {
    if (!currentPlayer) return

    // Optimistic UI update
    setIsMarkingUnsold(true)
    
    // Fire-and-forget API call - don't block UI
    fetch(`/api/auction/${auction.id}/mark-unsold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          toast.success('Player marked as unsold')
          
          // Trigger reveal animation immediately if we have next player
          if (data.nextPlayer) {
            console.log('🎬 Setting pending player from mark-unsold response:', data.nextPlayer)
            setPendingPlayer(data.nextPlayer)
            pendingPlayerRef.current = data.nextPlayer
            
            // Clear any existing fallback timeout
            if (fallbackTimeoutRef.current) {
              clearTimeout(fallbackTimeoutRef.current)
              fallbackTimeoutRef.current = null
            }
            
            // Start reveal animation immediately (no sold banner for unsold)
            setShowPlayerReveal(true)
            
            // Set a timeout fallback in case animation doesn't complete
            // Increased timeout to 8 seconds (5s reveal + 1.5s buffer + 1.5s extra safety)
            fallbackTimeoutRef.current = setTimeout(() => {
              console.warn('⚠️ Animation fallback triggered - setting player directly')
              const fallbackPlayer = pendingPlayerRef.current || data.nextPlayer
              if (fallbackPlayer) {
                setCurrentPlayer(fallbackPlayer)
                setCurrentBid(null)
                setBidHistory([])
                setHighestBidderId(null)
                setIsMarkingUnsold(false)
                setShowPlayerReveal(false)
                setPendingPlayer(null)
                pendingPlayerRef.current = null
                refreshAuctionState()
              }
              fallbackTimeoutRef.current = null
            }, 8000)
          } else {
            setIsMarkingUnsold(false)
          }
        } else {
          toast.error('Failed to mark as unsold')
          setIsMarkingUnsold(false)
        }
      })
      .catch(() => {
        toast.error('Network error')
        setIsMarkingUnsold(false)
      })
  }

  const handleUndoSaleConfirm = async () => {
    try {
      const response = await fetch(`/api/auction/${auction.id}/undo-sale`, { method: 'POST' })
      const data = await response.json()
      if (response.ok) {
        setUndoSaleDialogOpen(false)
        // Real-time updates will come via Pusher event (handleSaleUndo)
        // But we can also update optimistically from API response
        const isUnsoldUndo = data.undoneType === 'unsold'
        if (data.player && (isUnsoldUndo || data.bidder)) {
          console.log('🔄 Updating state from API response (optimistic)')

          // Calculate refund amount from bidder balance change - only
          // meaningful for a sold-undo, which is the only case with a bidder.
          const oldBidder = !isUnsoldUndo ? bidders.find(b => b.id === data.bidder.id) : undefined
          const refundAmount = oldBidder ? data.bidder.remainingPurse - oldBidder.remainingPurse : 0

          setPlayers(prev => prev.map(p =>
            p.id === data.player.id ? data.player : p
          ))
          if (!isUnsoldUndo) {
            setBidders(prev => prev.map(b =>
              b.id === data.bidder.id ? data.bidder : b
            ))
          }
          // Set the undone player as current player (API sets it as currentPlayerId)
          setCurrentPlayer(data.player)

          // Reset bid state
          setCurrentBid(null)
          setHighestBidderId(null)

          // Remove the reverted entry (and, for a sold-undo, all bids too) for
          // this player from the activity log.
          const revertedType = isUnsoldUndo ? 'unsold' : 'sold'
          const playerData = data.player.data as any
          const playerName = playerData?.Name || playerData?.name || 'Player'
          setFullBidHistory(prev => {
            const filtered = prev.filter(entry =>
              !(entry.playerId === data.player.id && (entry.type === revertedType || (!isUnsoldUndo && entry.type === 'bid')))
            )
            // Add undo event at the beginning
            const undoEvent: BidHistoryEntry = {
              type: 'sale-undo' as const,
              playerId: data.player.id,
              playerName: playerName,
              timestamp: new Date(),
              refundedAmount: isUnsoldUndo ? undefined : refundAmount
            }
            return [undoEvent, ...filtered]
          })

          // Clear bid history for this player to start fresh
          setBidHistory([])
        }
        // Toast will be shown by handleSaleUndo when Pusher event arrives
      } else {
        toast.error(data.error || 'Failed to undo sale')
      }
    } catch (error) {
      console.error('Error undoing sale:', error)
      toast.error('Network error while undoing sale')
    }
  }

  // Extract player data from JSON
  const getPlayerData = (player: Player | null) => {
    if (!player || !player.data) return {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return player.data as Record<string, any>
  }

  // Memoize player data extraction for performance
  const playerData = useMemo(() => getPlayerData(currentPlayer), [currentPlayer])
  const playerName = useMemo(() => {
    return playerData.name || playerData.Name || 'No Player Selected'
  }, [playerData])
  // extractBattingStats/extractBowlingStats each rebuild a normalized map of
  // every field on the player's raw uploaded data - real work, previously
  // redone from scratch on every re-render of this component (which happens
  // on every incoming bid during live bidding) even when the player on
  // screen hadn't changed.
  const battingStats = useMemo(() => extractBattingStats(playerData), [playerData])
  const bowlingStats = useMemo(() => extractBowlingStats(playerData), [playerData])
  const cricherosLink = useMemo(() => extractCricheroesLink(playerData), [playerData])

  // Determine auction phase based on player status and icon status
  const auctionPhase = useMemo(() => {
    if (!currentPlayer || players.length === 0) return null
    
    const totalPlayers = players.length
    const soldPlayers = players.filter(p => p.status === 'SOLD').length
    const unsoldPlayers = players.filter(p => p.status === 'UNSOLD').length
    const availablePlayers = players.filter(p => p.status === 'AVAILABLE').length
    
    // Bidder Choice players phase
    const iconPlayers = players.filter(p => (p as any).isIcon === true)
    const soldIconPlayers = iconPlayers.filter(p => p.status === 'SOLD').length
    const unsoldIconPlayers = iconPlayers.filter(p => p.status === 'UNSOLD').length
    const availableIconPlayers = iconPlayers.filter(p => p.status === 'AVAILABLE').length
    
    // Check if current player is icon
    const currentPlayerIsIcon = (currentPlayer as any)?.isIcon === true
    
    // Phase 1: Bidder Choice Auction (if Bidder Choice players exist and current is Bidder Choice or Bidder Choice players not finished)
    if (iconPlayers.length > 0 && (currentPlayerIsIcon || availableIconPlayers > 0)) {
      return {
        type: 'BIDDER_CHOICE',
        message: '⭐ Bidder Choice Auction Going On',
        color: 'from-purple-600 to-pink-600'
      }
    }
    
    // Phase 3: Remaining/Unsold Players (if there are unsold players and no available regular players left)
    if (unsoldPlayers > 0 && availablePlayers > 0 && availablePlayers === unsoldPlayers) {
      return {
        type: 'REMAINING_PLAYERS',
        message: '🔄 Remaining Players Auction Going On',
        color: 'from-orange-600 to-red-600'
      }
    }
    
    // Phase 2: Regular Players (default for all other cases when auction is ongoing)
    if (availablePlayers > 0) {
      return {
        type: 'ALL_PLAYERS',
        message: '🎯 All Player Auction Running',
        color: 'from-blue-600 to-cyan-600'
      }
    }
    
    return null
  }, [currentPlayer, players])

  // Check if there's any sold or unsold player to revert (for showing the
  // Undo Last Action button) - it now undoes whichever happened more
  // recently between the two, not just a sale.
  const hasUndoableAction = useMemo(() => {
    return players.some(p => p.status === 'SOLD' || p.status === 'UNSOLD')
  }, [players])

  // Preload images when player or bidders change
  useEffect(() => {
    const preloadImages = async () => {
      // Preload player image
      if (currentPlayer?.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = currentPlayer.data as Record<string, any>
        const imageUrl = data.imageUrl || data.ImageUrl || data.picUrl || data.PicUrl
        if (imageUrl) {
          try {
            const fileId = imageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]
            if (fileId) {
              const proxyImageUrl = `/api/proxy-image?id=${fileId}`
              await preloadImage(proxyImageUrl)
              setIsImageLoading(false)
            }
          } catch (error) {
            console.warn('Failed to preload player image:', error)
          }
        }
      }

      // Preload bidder logos
      if (bidders.length > 0) {
        bidders.forEach(bidder => {
          if (bidder.logoUrl) {
            preloadImage(bidder.logoUrl).catch(() => {
              // Silently fail for bidder logos
            })
          }
        })
      }
    }

    preloadImages()
  }, [currentPlayer, bidders])

  // Get all player names for reveal animation (must be before early return)
  // Only include players that are AVAILABLE (not SOLD, not UNSOLD, not RETIRED)
  const allPlayerNames = useMemo(() => {
    // Filter out SOLD, UNSOLD, and RETIRED players - only show AVAILABLE players
    const availablePlayers = players.filter(p => p.status === 'AVAILABLE')
    
    // If we have a pending player, make sure it's included (even if not in players array yet)
    const allPlayers = [...availablePlayers]
    if (pendingPlayer && !allPlayers.find(p => p.id === pendingPlayer.id)) {
      // Only add pending player if it's AVAILABLE
      if (pendingPlayer.status === 'AVAILABLE') {
        allPlayers.push(pendingPlayer)
      }
    }
    
    // Extract names and filter out empty/undefined names
    const names = allPlayers
      .map(p => {
        const data = p.data as any
        return data?.name || data?.Name || data?.player_name || null
      })
      .filter((name): name is string => name !== null && name !== undefined && name !== '')
    
    console.log('🎭 All player names for animation:', {
      totalPlayers: players.length,
      availablePlayers: availablePlayers.length,
      namesCount: names.length,
      names: names.slice(0, 5) // Log first 5 names
    })
    
    return names.length > 0 ? names : ['Player 1', 'Player 2', 'Player 3'] // Fallback if no names
  }, [players, pendingPlayer])

  const pendingPlayerName = useMemo(() => {
    if (!pendingPlayer) return ''
    const data = pendingPlayer.data as any
    return data?.name || data?.Name || data?.player_name || 'Unknown Player'
  }, [pendingPlayer])

  // Cleanup fallback timeout on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
      }
    }
  }, [])

  // Early return for SSR
  if (!isClient) {
    return null
  }

  // Main return
  return (
    <>
      {/* Connectivity lost - only the admin can record sales, so only they
          need the offline console; a bidder viewing their own console has
          nothing to do there. The local snapshot below already mirrors
          continuously, so it's current the moment this appears - no delay
          between "connection dropped" and "offline console is ready." */}
      {!isOnline && viewMode === 'admin' && (
        <div className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white px-4 py-2.5 shadow-lg">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <WifiOff className="h-4 w-4 flex-shrink-0" />
              <span>Connection lost - your device can&apos;t reach the server right now.</span>
            </div>
            <Link
              href={`/auction/${auction.id}/offline`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-red-700 text-xs font-bold hover:bg-red-50 flex-shrink-0"
            >
              Switch to Offline Console
            </Link>
          </div>
        </div>
      )}

      {/* Going Live Banner - Full Page Overlay */}
      <GoingLiveBanner
        show={showGoingLiveBanner}
        onComplete={() => setShowGoingLiveBanner(false)}
      />
      
      {/* Hide main content when banner is showing */}
      {!showGoingLiveBanner && (
        <div className={`${(showPinnedConsole || isBidConsoleOpen) ? 'lg:mr-[30%]' : ''} px-4 sm:px-6 lg:px-8 transition-all duration-200`}>
      <div className="max-w-[1400px] mx-auto py-4 sm:py-6 space-y-4">
        {/* Enhanced Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden">
          {/* Top Section */}
          <div className="px-3 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
              {/* Left: Title, Status, and Stats */}
              <div className="flex-1 w-full sm:w-auto">
                {/* Title and Status - Compact on mobile */}
                <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3 mb-2">
                  <h1 className="text-base sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-100">{auction.name}</h1>
                  <Badge className={`px-2 py-0.5 sm:px-3 sm:py-1 text-[10px] sm:text-sm font-semibold rounded-full flex-shrink-0 ${
                    isLiveStatus(auction.status) 
                      ? 'bg-green-500 text-white animate-pulse' 
                      : auction.status === 'PAUSED'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-500 text-white'
                  }`}>
                    {auction.status}
                  </Badge>
                </div>
                
                {auction.description && (
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2 hidden sm:block">{auction.description}</p>
                )}
                
                {/* Inline Stats - Compact grid on mobile */}
                <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3 text-[10px] sm:text-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="font-bold text-gray-900 dark:text-gray-100">{initialStats.total}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Sold:</span>
                    <span className="font-bold text-green-600">{initialStats.sold}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Unsold:</span>
                    <span className="font-bold text-yellow-600">{initialStats.unsold}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Left:</span>
                    <span className="font-bold text-purple-600">{initialStats.remaining}</span>
                  </div>
                  {/* Progress indicator - Full width on mobile */}
                  <div className="col-span-4 sm:col-span-1 flex items-center gap-2 sm:pl-2 sm:border-l border-gray-300 dark:border-gray-600 mt-1 sm:mt-0">
                    <div className="flex-1 sm:w-24 lg:w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 sm:h-2">
                      <div 
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${((initialStats.sold + initialStats.unsold) / initialStats.total * 100)}%` }}
                      />
                    </div>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-[10px] sm:text-xs flex-shrink-0">
                      {((initialStats.sold + initialStats.unsold) / initialStats.total * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Right: Share and Admin Controls - Always visible */}
              <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 h-8 w-8 sm:w-auto sm:h-9 p-0 sm:px-3"
                  >
                    <Trophy className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Team Stats</span>
                  </Button>
                </Link>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = window.location.href
                    navigator.clipboard.writeText(url).then(() => {
                      toast.success('Auction link copied to clipboard!')
                    }).catch(() => {
                      toast.error('Failed to copy link')
                    })
                  }}
                  className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 h-8 w-8 sm:w-auto sm:h-9 p-0 sm:px-3"
                >
                  <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
                
                {viewMode === 'admin' && (
                  <>
                    <Button
                      onClick={() => setIsBidConsoleOpen(true)}
                      size="sm"
                      className="text-xs sm:text-sm px-2 sm:px-3 bg-emerald-600 hover:bg-emerald-700 text-white hidden sm:inline-flex h-9"
                      title="Open Bidding Console"
                    >
                      Console
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-8 sm:w-auto sm:h-9 p-0 sm:px-3">
                          <MoreVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 z-[100] bg-white dark:bg-gray-800 shadow-xl">
                        <DropdownMenuItem
                          onSelect={() => setIsBidConsoleOpen(true)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer sm:hidden"
                        >
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Bidding Console
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => window.open(`/auction/${auction.id}/offline`, '_blank')}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <WifiOff className="h-4 w-4 mr-2" />
                          Offline Fallback
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => window.open(`/api/auction/${auction.id}/export-results`, '_blank')}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Export Results (with Photos &amp; Rules)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={handleStartAuction}
                          disabled={isLiveStatus(auction.status)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Start Auction
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handlePauseResume} 
                          disabled={!isLiveStatus(auction.status)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                          {isPaused ? 'Resume' : 'Pause'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleNextPlayer} 
                          disabled={!isLiveStatus(auction.status)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <SkipForward className="h-4 w-4 mr-2" />
                          Next Player
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleEndAuction} 
                          disabled={!isLiveStatus(auction.status)} 
                          className="text-red-600 dark:text-red-400 cursor-pointer"
                        >
                          <Square className="h-4 w-4 mr-2" />
                          End Auction
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleResetAuction} 
                          className="text-orange-600 dark:text-orange-400 cursor-pointer"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reset Auction
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
            </div>
          </div>
        </div>

        {/* Stats cards removed - now inline in header */}

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Center Stage - Spotlight */}
          <div className="col-span-1 lg:col-span-2 order-1">
            <Card className="min-h-[300px] sm:min-h-[500px] bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/30 dark:from-gray-800 dark:via-blue-900/10 dark:to-indigo-900/10 border-0">
              <AnimatePresence>
                {soldAnimation && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center bg-green-500 text-white text-6xl font-bold z-50 rounded-lg"
                  >
                    SOLD!
                  </motion.div>
                )}
              </AnimatePresence>
              
              {/* Mobile Current Bid Banner */}
              <div className="lg:hidden sticky top-0 z-30 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3 rounded-t-lg shadow-lg">
                {currentBid ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        <span className="font-semibold text-xs uppercase tracking-wide">Current Bid</span>
                      </div>
                      <div className="text-lg font-bold">
                        {formatCurrency(currentBid.amount)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="opacity-90">By {currentBid.bidderName}</span>
                      {currentBid.teamName && (
                        <span className="bg-white/20 px-2 py-0.5 rounded-full">{currentBid.teamName}</span>
                      )}
                    </div>
                    {bidHistory.length > 1 && (
                      <div className="text-xs opacity-75">
                        {bidHistory.length} bid{bidHistory.length !== 1 ? 's' : ''} placed
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-sm py-2">
                    <span className="opacity-90">No bids yet - Be the first to bid!</span>
                  </div>
                )}
              </div>
              
          {/* New Player Spotlight Card (presentational) - client only to avoid SSR drift */}
          {isClient && (
            <div className="mb-4 space-y-4">
              {/* Pool exhausted: nothing left to auction. Shown above the (now
                  stale) last-sold player card instead of leaving the screen
                  looking frozen with no explanation. */}
              {poolExhausted && (
                <div className="rounded-xl border-2 border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/40 dark:to-indigo-950/40 p-4 sm:p-6 text-center space-y-3">
                  <PartyPopper className="h-8 w-8 mx-auto text-purple-600 dark:text-purple-400" />
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">All Players Sold</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Every player has been sold or marked unsold with no one left to recycle. This auction is ready to be ended.
                  </p>
                  {viewMode === 'admin' && (
                    <Button onClick={handleEndAuction} className="bg-purple-600 hover:bg-purple-700 text-white">
                      End Auction
                    </Button>
                  )}
                </div>
              )}
              {/* Player Card Container with Animation Overlay */}
              <div className="relative mx-1 sm:mx-0">
                {/* Player Reveal Animation - Inside Player Card */}
                <AnimatePresence mode="wait">
                  {showPlayerReveal && pendingPlayer && (
                    <PlayerRevealAnimation
                      key={`reveal-${pendingPlayer.id}`}
                      allPlayerNames={allPlayerNames}
                      finalPlayerName={pendingPlayerName}
                      onComplete={handleRevealComplete}
                      duration={5000}
                    />
                  )}
                </AnimatePresence>
                
                    {/* Combined Auction Phase Banner + Live Indicators */}
                {auctionPhase && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`absolute -top-0 left-0 right-0 z-10 bg-gradient-to-r ${auctionPhase.color} px-2 sm:px-4 py-1.5 sm:py-2 shadow-xl rounded-t-xl border-b-2 border-white/30`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {/* Left: Auction Phase Message */}
                      <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0">
                        <span className="text-[9px] sm:text-xs md:text-sm font-bold text-white truncate">{auctionPhase.message}</span>
                      </div>
                      
                      {/* Right: Status Indicators */}
                      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                        <Badge className="bg-green-500 text-white text-[9px] sm:text-[10px] font-bold px-1 py-0.5 sm:px-1.5 sm:py-0.5 animate-pulse">
                          ● LIVE
                        </Badge>
                        {viewMode === 'admin' && (
                          <Badge className="bg-white/20 text-white border-white/30 text-[9px] sm:text-[10px] font-semibold px-1 py-0 sm:px-1.5 sm:py-0.5">
                            Admin
                          </Badge>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
                <div className={auctionPhase ? 'pt-8 sm:pt-10' : ''}>
                  <PlayerCard
                currentBid={currentBid}
                lastYear={currentPlayer?.lastYearPrice != null ? {
                  price: currentPlayer.lastYearPrice,
                  teamName: currentPlayer.lastYearTeamName,
                  auctionName: currentPlayer.lastYearAuctionName,
                } : null}
                name={playerName}
                imageUrl={(() => {
                  const keys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
                  const value = keys.map(key => playerData?.[key]).find(v => v && String(v).trim())
                  if (!value) {
                    console.log('DEBUG - Player data fields:', Object.keys(playerData))
                    return undefined
                  }
                  const photoStr = String(value).trim()
                  let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
                  if (match && match[1]) {
                    return `/api/proxy-image?id=${match[1]}`
                  }
                  match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
                  if (match && match[1]) {
                    return `/api/proxy-image?id=${match[1]}`
                  }
                  if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) {
                    return photoStr
                  }
                  return undefined
                })()}
                basePrice={(currentPlayer?.data as any)?.['Base Price'] || (currentPlayer?.data as any)?.['base price'] || 1000}
                tags={((currentPlayer as any)?.isIcon || (currentPlayer?.data as any)?.isIcon) ? [{ label: 'Bidder Choice', color: 'purple' }] : []}
                profileLink={cricherosLink}
                battingStats={battingStats}
                bowlingStats={bowlingStats}
                fields={(() => {
                  
                  const essentials: Array<{ label: string; value: string }> = []
                  const add = (label: string, keys: string[]) => {
                    for (const key of keys) {
                      const v = (playerData as any)[key]
                      if (v) {
                        essentials.push({ label, value: String(v) })
                        return
                      }
                    }
                  }
                  add('Batting', ['Batting', 'batting', 'Batting Type', 'batting type', 'BAT', 'Bat'])
                  add('Bowling', ['Bowling', 'bowling', 'Bowling Type', 'bowling type', 'BOWL', 'Bowl'])
                  add('Fielding', ['Fielding', 'fielding', 'FIELD', 'Field'])
                  add('Speciality', ['Speciality', 'speciality', 'Specialty', 'specialty', 'Role', 'role'])
                  add('Wicket Keeper', ['Wicket Keeper', 'wicket keeper', 'Wicket Keeper', 'WicketKeeper', 'wicketKeeper', 'WK', 'wk'])
                  return essentials
                })()}
              />
                </div>
              </div>
              
              {/* Action Buttons Below Player Card (Admin Only) */}
              {viewMode === 'admin' && (
                <div className="px-4">
                  <ActionButtons
                    onMarkSold={handleMarkSold}
                    onMarkUnsold={handleMarkUnsold}
                    onUndoSale={hasUndoableAction ? () => setUndoSaleDialogOpen(true) : undefined}
                    isMarkingSold={isMarkingSold}
                    isMarkingUnsold={isMarkingUnsold}
                    hasBids={bidHistory.length > 0 || currentBid !== null}
                    isDisabled={poolExhausted}
                  />
                </div>
              )}
            </div>
          )}

          <CardHeader className="hidden">
                <div className="flex flex-col items-center gap-3">
                  {(() => {
                    const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo']
                    
                    // If no profile photo, show placeholder with player name
                    if (!profilePhotoLink) {
                      return (
                        <>
                          <div className="w-48 h-48 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center ring-4 ring-blue-200 dark:ring-blue-900 shadow-2xl">
                            <span className="text-gray-600 dark:text-gray-400 text-4xl sm:text-5xl lg:text-6xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <CardTitle className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 text-center">{playerName}</CardTitle>
                            {currentPlayer?.data && (currentPlayer.data as { isIcon?: boolean }).isIcon && (
                              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg px-3 py-1 text-sm font-bold">
                                ⭐ BIDDER CHOICE
                              </Badge>
                            )}
                          </div>
                        </>
                      )
                    }
                    
                    // Extract file ID from the Google Drive URL
                    const fileId = profilePhotoLink.includes('/file/d/') 
                      ? profilePhotoLink.match(/\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1]
                      : profilePhotoLink.includes('open?id=')
                      ? profilePhotoLink.match(/open\?id=([a-zA-Z0-9-_]+)/)?.[1]
                      : profilePhotoLink.includes('id=')
                      ? profilePhotoLink.match(/id=([a-zA-Z0-9-_]+)/)?.[1]
                      : null
                      
                    // Use proxy API to bypass CORB
                    const proxyImageUrl = fileId ? `/api/proxy-image?id=${fileId}` : null
                      
                    return (
                      <>
                        <div className="w-48 h-48 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden relative ring-4 ring-blue-200 dark:ring-blue-900 shadow-2xl">
                          {proxyImageUrl ? (
                            <>
                              {isImageLoading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full z-10">
                                  <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-300 rounded-full animate-spin"></div>
                                </div>
                              )}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img 
                                src={proxyImageUrl}
                                alt={playerName}
                                className="rounded-full object-contain w-full h-full p-2"
                                onError={(e) => {
                                  setIsImageLoading(false)
                                  console.error('Image failed to load, showing initial')
                                  const img = e.currentTarget
                                  img.style.display = 'none'
                                  const parent = img.parentElement
                                  if (parent) {
                                    parent.innerHTML = `
                                      <span class="text-gray-600 dark:text-gray-400 text-4xl sm:text-5xl lg:text-6xl font-semibold">
                                        ${playerName.charAt(0).toUpperCase()}
                                      </span>
                                    `
                                  }
                                }}
                                onLoad={() => {
                                  setIsImageLoading(false)
                                }}
                              />
                            </>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400 text-4xl sm:text-5xl lg:text-6xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 text-center">{playerName}</CardTitle>
                          {currentPlayer?.data && (currentPlayer.data as { isIcon?: boolean }).isIcon && (
                            <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg px-3 py-1 text-sm font-bold">
                              ⭐ BIDDER CHOICE
                            </Badge>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-6">
                {/* Essential Fields */}
                <div className="hidden">
                  {(() => {
                    // Define essential fields to show always
                    const essentialFields = ['Speciality', 'Batting Type', 'Bowling Type', 'Wicket Keeper']
                    const allFields = Object.entries(playerData).filter(([key]) => 
                      key.toLowerCase() !== 'name' && 
                      !key.toLowerCase().includes('profile photo') &&
                      !key.toLowerCase().includes('photo')
                    )
                    
                    const essentialData = allFields.filter(([key]) => 
                      essentialFields.some(ef => key.toLowerCase().includes(ef.toLowerCase()))
                    )
                    
                    // Group essential fields into a cleaner layout
                    return (
                      <div className="space-y-2">
                        {essentialData.map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                            <span className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400">{key}</span>
                            <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* Read More Section (hidden in new design) */}
                {false && (() => {
                  const essentialFields = ['Speciality', 'Batting Type', 'Bowling Type', 'Wicket Keeper']
                  const allFields = Object.entries(playerData).filter(([key]) => 
                    key.toLowerCase() !== 'name' && 
                    !key.toLowerCase().includes('profile photo') &&
                    !key.toLowerCase().includes('photo')
                  )
                  
                  const nonEssentialFields = allFields.filter(([key]) => 
                    !essentialFields.some(ef => key.toLowerCase().includes(ef.toLowerCase()))
                  )
                  
                  if (nonEssentialFields.length === 0) return null
                  
                  return (
                    <div className="space-y-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllPlayerDetails(!showAllPlayerDetails)}
                        className="w-full text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        {showAllPlayerDetails ? (
                          <>
                            <ChevronUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                            Show Less Details
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                            Show More Details ({nonEssentialFields.length})
                          </>
                        )}
                      </Button>
                      
                      <AnimatePresence>
                        {showAllPlayerDetails && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-2 overflow-hidden"
                          >
                            {nonEssentialFields.map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                                <span className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 truncate">{key}</span>
                                <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 ml-2 text-right">{String(value)}</span>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })()}
                {/* Current Bid Strip (presentational) */}
                {isClient && (
                  <div className="pt-4 mt-4">
                    <BidAmountStrip
                      amount={currentBid?.amount ?? null}
                      bidderName={currentBid?.bidderName}
                      teamName={currentBid?.teamName}
                      nextMin={(() => {
                        const currentBidAmount = currentBid?.amount || 0
                        const rules = auction.rules as any
                        const minIncrement = (rules?.minBidIncrement || 1000)
                        return currentBidAmount + minIncrement
                      })()}
                    />
                  </div>
                )}
                
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar: Bid History (sticky) */}
          <div className="order-2 lg:order-1 hidden lg:block space-y-4">
            
            {/* Bid console moved to sliding drawer */}
            {/* Bidder Controls - Show at top of sidebar for bidders */}
            {viewMode === 'bidder' && userBidder && isLiveStatus(auction.status) && (
              <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 shadow-lg">
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Place Your Bid</CardTitle>
                  {error && (
                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                      {error}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-4 sm:p-6 space-y-3">
                  {/* Remaining Purse */}
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Remaining Purse: <span className="text-green-600 font-bold">{formatCurrency(userBidder.remainingPurse)}</span>
                  </div>
                  
                  {/* Current Bid Display */}
                  {currentBid && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        Current Bid: <span className="font-bold text-blue-600">{formatCurrency(currentBid.amount)}</span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        By: {currentBid.bidderName} {currentBid.teamName && `(${currentBid.teamName})`}
                      </div>
                    </div>
                  )}
                  
                  {/* Raise Bid Button */}
                    <Button 
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-6 text-base"
                    onClick={async () => {
                      if (!userBidder) {
                        showBidError('Please log in to place a bid')
                        return
                      }
                      
                      // Check team size BEFORE allowing bid
                      const rules = auction.rules as any
                      // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
                      const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
                      if (maxTeamSize) {
                        const playersBought = players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
                        console.log('[Raise Bid] Team size check:', { playersBought, maxTeamSize, maxPlayersCanBuy: maxTeamSize - 1 })
                        if (playersBought >= maxTeamSize - 1) {
                          // Don't show error here - let backend handle it to avoid duplicate messages
                          // The button should already be disabled via isTeamFull, but if clicked, backend will show error
                          return
                        }
                      }
                      
                      // Always use base increment (1000)
                      const currentBidAmount = currentBid?.amount || 0
                      const minIncrement = (rules?.minBidIncrement || 1000)
                      const totalBid = currentBidAmount + minIncrement
                      
                      if (totalBid > userBidder.remainingPurse) {
                        showBidError('Insufficient remaining purse')
                        return
                      }

                      setIsPlacingBid(true)
                      setError('')

                      try {
                        const response = await fetch(`/api/auction/${auction.id}/bid`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            bidderId: userBidder.id,
                            amount: totalBid
                          })
                        })

                        const data = await response.json()

                        if (response.ok) {
                          setBidAmount(0)
                          toast.success('Bid placed successfully!')
                        } else {
                          showBidError(data.error || 'Failed to place bid')
                        }
                      } catch {
                        showBidError('Network error. Please try again.')
                      } finally {
                        setIsPlacingBid(false)
                      }
                    }}
                    disabled={isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id) || isTeamFull}
                  >
                    {isPlacingBid ? 'Placing Bid...' : isTeamFull ? 'Team Full' : (() => {
                      const currentBidAmount = currentBid?.amount || 0
                      const rules = auction.rules as AuctionRules | undefined
                      const minIncrement = (rules?.minBidIncrement || 1000)
                      return `Raise Bid (+₹${(minIncrement / 1000).toFixed(0)}K)`
                    })()}
                    </Button>

                  {/* Custom Bid */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Bid Amount (₹)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Enter total bid amount"
                        value={bidAmount === 0 ? '' : bidAmount}
                        onChange={(e) => {
                          const value = e.target.value === '' ? 0 : Number(e.target.value)
                          setBidAmount(value)
                          setError('')
                        }}
                        className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                      />
                      <Button 
                        className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap px-6"
                        onClick={async () => {
                          if (!userBidder) {
                            showBidError('Please log in to place a bid')
                            return
                          }

                          // Check team size BEFORE allowing bid
                          // Note: Backend also validates this, but we check here to prevent unnecessary API calls
                          const rules = auction.rules as any
                          // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
                          const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
                          if (maxTeamSize) {
                            const playersBought = players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
                            if (playersBought >= maxTeamSize - 1) {
                              // Don't show error here - let backend handle it to avoid duplicate messages
                              // The button should already be disabled via isTeamFull, but if clicked, backend will show error
                              return
                            }
                          }

                          if (!bidAmount || bidAmount <= 0) {
                            showBidError('Please enter a valid bid amount')
                            return
                          }

                          const currentBidAmount = currentBid?.amount || 0
                          const minIncrement = (rules?.minBidIncrement || 1000)
                          const difference = bidAmount - currentBidAmount

                          if (bidAmount <= currentBidAmount) {
                            showBidError('Bid must exceed current amount')
                            return
                          }

                          if (difference < minIncrement) {
                            showBidError(`Bid must be at least ₹${(currentBidAmount + minIncrement).toLocaleString('en-IN')}`)
                            return
                          }

                          if (bidAmount % 1000 !== 0) {
                            showBidError('Bid must be in multiples of ₹1,000')
                            return
                          }

                          if (bidAmount > userBidder.remainingPurse) {
                            showBidError('Insufficient remaining purse')
                            return
                          }

                          setIsPlacingBid(true)
                          setError('')

                          // Optimistically update currentBid immediately
                          const previousBid = currentBid
                          setCurrentBid({
                            bidderId: userBidder.id,
                            amount: bidAmount,
                            bidderName: userBidder.user?.name || userBidder.username,
                            teamName: userBidder.teamName || undefined
                          })

                          try {
                            const response = await fetch(`/api/auction/${auction.id}/bid`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                bidderId: userBidder.id,
                                amount: bidAmount
                              })
                            })

                            const data = await response.json()

                            if (response.ok) {
                              setBidAmount(0)
                              toast.success('Bid placed successfully!')
                            } else {
                              // Revert optimistic update on error
                              setCurrentBid(previousBid)
                              showBidError(data.error || 'Failed to place bid')
                            }
                          } catch {
                            // Revert optimistic update on error
                            setCurrentBid(previousBid)
                            showBidError('Network error. Please try again.')
                          } finally {
                            setIsPlacingBid(false)
                          }
                        }}
                        disabled={isPlacingBid || isTeamFull}
                      >
                        {isPlacingBid ? 'Placing...' : isTeamFull ? 'Team Full' : 'Place Bid'}
                      </Button>
                    </div>
                  </div>
              </CardContent>
            </Card>
            )}

          {/* Bid History */}
          {bidErrors.length > 0 && (
            <div className="space-y-2 mb-4">
              {bidErrors.map(err => (
                <div
                  key={err.id}
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs sm:text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
                >
                  <span className="mt-0.5 text-red-600 dark:text-red-300">⚠️</span>
                  <span>{err.message}</span>
                </div>
              ))}
            </div>
          )}
          <Card className="border-0 lg:sticky lg:top-[calc(theme(spacing.4)+theme(spacing.4)+theme(spacing.4))]">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <span>📋</span> Live Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <div className="max-h-[200px] sm:max-h-[300px] lg:max-h-[500px] overflow-y-auto pr-2">
                <ActivityLog
                  items={bidHistory as any}
        onUndoBid={viewMode === 'admin' ? async (entry) => {
          console.log('🎯 Undo button clicked for entry:', entry)
          try {
            if (!entry.bidderId) {
              console.log('❌ No bidderId in entry')
              return
            }
            console.log('📡 Calling undo-bid API with bidderId:', entry.bidderId)
            const response = await fetch(`/api/auction/${auction.id}/undo-bid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bidderId: entry.bidderId })
            })
            console.log('📡 API response status:', response.status)
            if (!response.ok) {
              const data = await response.json()
              console.log('❌ API error:', data)
              toast.error(data.error || 'Failed to undo bid')
            } else {
              console.log('✅ API success')
              toast.success('Bid undone successfully')
              // Reload page to show updated state (Pusher real-time not working due to React Strict Mode)
              setTimeout(() => window.location.reload(), 500)
            }
          } catch (error) {
            console.log('❌ Exception:', error)
            toast.error('Failed to undo bid')
          }
        } : undefined}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick Bid Banner - Now moved to sidebar */}

        {/* Bidders Grid moved into right-side Bid Console for admin */}
              </div>

      {/* Mobile Bid Controls - Show for bidders */}
      {viewMode === 'bidder' && userBidder && auction.status === 'LIVE' && (
        <>
          {/* Floating action buttons */}
          <div className="lg:hidden fixed bottom-28 right-4 z-50 flex flex-col gap-3 items-end">
            {/* Quick Raise Bid Button */}
                    <Button
              onClick={() => {
                // Always use base increment (1000)
                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = (rules?.minBidIncrement || 1000)
                const totalBid = currentBidAmount + minIncrement
                
                if (totalBid > userBidder.remainingPurse) {
                  showBidError('Insufficient remaining purse')
                  return
                }
                
                setIsPlacingBid(true)
                
                fetch(`/api/auction/${auction.id}/bid`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bidderId: userBidder.id,
                    amount: totalBid
                  })
                }).then(response => response.json())
                  .then(data => {
                    if (data.error) {
                      showBidError(data.error)
                    } else {
                      toast.success('Bid placed successfully!')
                    }
                  }).catch(() => {
                    showBidError('Network error. Please try again.')
                  }).finally(() => {
                    setIsPlacingBid(false)
                  })
              }}
              className={`rounded-full px-4 py-5 shadow-2xl text-white flex items-center gap-2 ${
                (isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id))
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
              disabled={isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id) || isTeamFull}
            >
              <TrendingUp className="h-5 w-5" />
              <span className="font-semibold text-sm">{(() => {
                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = (rules?.minBidIncrement || 1000)
                return `+₹${(minIncrement / 1000).toFixed(0)}K`
              })()}</span>
                    </Button>
            
            {/* Custom Bid Button */}
            <Button 
              onClick={() => setCustomBidModalOpen(true)}
              className="rounded-full px-4 py-5 shadow-2xl bg-blue-600 hover:bg-blue-700 text-white"
            >
              <span className="font-semibold text-sm">Custom</span>
            </Button>
                </div>
        </>
      )}

      {/* Mobile Bid History Floating Button */}
      <div className="lg:hidden fixed bottom-4 right-4 z-50">
        <Button 
          onClick={() => setBidHistoryModalOpen(true)}
          className="rounded-full px-5 py-6 shadow-2xl bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
        >
          <Clock className="h-5 w-5 mr-2" />
          <span className="text-sm font-semibold">History</span>
        </Button>
      </div>

      {/* Mobile Bid History Bottom Modal */}
      <Dialog open={bidHistoryModalOpen} onOpenChange={setBidHistoryModalOpen}>
        <DialogContent className="!fixed !bottom-0 !left-0 !right-0 !top-auto !translate-x-0 !translate-y-0 !w-full !max-w-full rounded-t-lg p-0 sm:hidden" style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} showCloseButton={false}>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-t-lg flex flex-col" style={{ maxHeight: '70vh' }}>
            {/* Drag Handle */}
            <div className="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-2 mb-4" />
            
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Bid History</DialogTitle>
              <DialogDescription className="sr-only">View the live bidding history for this player</DialogDescription>
            </div>
            
            {/* Bid History Content */}
            <div className="px-4 py-2 space-y-2 flex-1 overflow-y-auto">
              {bidHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No bids yet</p>
                </div>
              ) : (
                bidHistory.map((bid, index) => {
                // Handle sold/unsold events
                if (bid.type === 'sold') {
                  const bidTime = new Date(bid.timestamp)
                  let timeAgo = ''
                  if (isClient) {
                    const now = new Date()
                    const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                    timeAgo = timeDiff < 60 ? `${timeDiff}s ago` : timeDiff < 3600 ? `${Math.floor(timeDiff / 60)}m ago` : bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  } else {
                    timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                  
                  return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="text-sm border-l-4 border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/40 dark:to-emerald-900/40 rounded-lg p-3 mb-2 shadow-lg"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">🎉</span>
                          <div className="font-bold text-lg text-green-800 dark:text-green-300">
                            {bid.playerName} SOLD!
                      </div>
                      </div>
                        <div className="flex items-center gap-2 mb-1 text-sm">
                          <span className="text-gray-700 dark:text-gray-300">To:</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                          {bid.teamName && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200">({bid.teamName})</span>
                          )}
                      </div>
                        <div className="flex items-center gap-2">
                          {bid.amount && (
                            <span className="text-xl font-bold text-green-600 dark:text-green-400">
                              {formatCurrency(bid.amount)}
                            </span>
                          )}
                          <span className="text-xs text-green-600 dark:text-green-400">⏰ {timeAgo}</span>
                    </div>
                      </motion.div>
                  )
                }
                
                if (bid.type === 'unsold') {
                  const bidTime = new Date(bid.timestamp)
                  let timeAgo = ''
                  if (isClient) {
                    const now = new Date()
                    const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                    timeAgo = timeDiff < 60 ? `${timeDiff}s ago` : timeDiff < 3600 ? `${Math.floor(timeDiff / 60)}m ago` : bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  } else {
                    timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                  
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm border-l-4 border-orange-500 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/40 dark:to-red-900/40 rounded-lg p-3 mb-2 shadow-md"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">⏭️</span>
                        <div className="font-bold text-lg text-orange-800 dark:text-orange-300">
                          {bid.playerName} - UNSOLD
                      </div>
                      </div>
                      <div className="text-sm text-orange-700 dark:text-orange-400 mb-1">
                        No buyer found • Moving to next player
                      </div>
                      <div className="text-xs text-orange-600 dark:text-orange-400">
                        ⏰ {timeAgo}
                    </div>
                    </motion.div>
                  )
                }
                
                if (bid.type === 'sale-undo') {
                  const bidTime = new Date(bid.timestamp)
                  let timeAgo = ''
                  if (isClient) {
                    const now = new Date()
                    const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                    timeAgo = timeDiff < 60 ? `${timeDiff}s ago` : timeDiff < 3600 ? `${Math.floor(timeDiff / 60)}m ago` : bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  } else {
                    timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                  
                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm border-l-4 border-purple-500 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/40 dark:to-pink-900/40 rounded-lg p-3 mb-2 shadow-md"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">↩️</span>
                        <div className="font-bold text-lg text-purple-800 dark:text-purple-300">
                          {bid.playerName} - SALE UNDONE
                      </div>
                      </div>
                      {bid.refundedAmount && (
                        <div className="text-sm text-purple-700 dark:text-purple-400 mb-1">
                          Refunded {formatCurrency(bid.refundedAmount)} • Player restored to available
                        </div>
                      )}
                      <div className="text-xs text-purple-600 dark:text-purple-400">
                        ⏰ {timeAgo}
                    </div>
                    </motion.div>
                  )
                }
                
                // Handle regular bids - ensure amount exists
                if (!bid.amount) {
                  return null // Skip entries without amount
                }
                const bidTime = new Date(bid.timestamp)
                
                let timeAgo = ''
                if (isClient) {
                  const now = new Date()
                  const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                  
                  if (timeDiff < 60) {
                    timeAgo = `${timeDiff} second${timeDiff !== 1 ? 's' : ''} ago`
                  } else if (timeDiff < 3600) {
                    const minutes = Math.floor(timeDiff / 60)
                    timeAgo = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
                  } else {
                    timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                } else {
                  timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
                
                const isLatestBid = index === 0 // Latest bid is first in the array
                const increment = isLatestBid
                  ? bid.amount 
                  : bid.amount - (bidHistory[index - 1]?.amount || bid.amount)
                
                const commentary = isLatestBid
                  ? "🎯 Current Top Bid!"
                  : increment > 50000 
                    ? "🚀 Big Jump!"
                    : "💪 Standard Bid"
                
                // Enhanced styling for auction-like appearance
                const bidStyle = isLatestBid 
                  ? "border-l-4 border-emerald-500 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/30 dark:to-green-900/30 rounded-lg p-3 shadow-md animate-pulse"
                  : increment > 50000
                    ? "border-l-4 border-purple-500 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 rounded-lg p-3"
                    : "border-l-4 border-blue-500 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-lg p-3"
                
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={`text-sm ${bidStyle} mb-2`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                      {bid.teamName && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">({bid.teamName})</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${
                          isLatestBid 
                            ? "bg-emerald-600 text-white" 
                            : increment > 50000 
                              ? "bg-purple-600 text-white"
                              : "bg-blue-600 text-white"
                        }`}>
                          {commentary}
                        </span>
                        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(bid.amount)}
                        </span>
                      </div>
                      {isLatestBid && viewMode === 'admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (!confirm('Undo this bid?')) return
                            try {
                              const response = await fetch(`/api/auction/${auction.id}/undo-bid`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ bidderId: bid.bidderId })
                              })
                              if (!response.ok) {
                                const data = await response.json()
                                toast.error(data.error || 'Failed to undo bid')
                              } else {
                                toast.success('Bid undone successfully')
                              }
                            } catch (error) {
                              toast.error('Failed to undo bid')
                            }
                          }}
                          className="h-7 px-2 text-xs bg-red-500 hover:bg-red-600 text-white border-red-600"
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          Undo
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>⏰ {timeAgo}</span>
                      {increment > 0 && !isLatestBid && (
                        <span className="text-green-600 dark:text-green-400">↑ +₹{increment.toLocaleString('en-IN')}</span>
                      )}
                    </div>
                  </motion.div>
                )
              }))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>
      )}

    {/* Custom Bid Modal - For Both Admin and Bidder */}
    <Dialog open={customBidModalOpen} onOpenChange={(open) => {
      setCustomBidModalOpen(open)
      if (!open) {
        setSelectedBidderForBid(null)
        setBidAmount(0)
        setError('')
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Custom Bid
          {selectedBidderForBid && (() => {
            const selectedBidder = bidders.find(b => b.id === selectedBidderForBid)
            return selectedBidder ? ` - ${selectedBidder.teamName || selectedBidder.user?.name}` : ''
          })()}
        </DialogTitle>
        <DialogDescription className="sr-only">Place a custom bid amount</DialogDescription>
        <div className="space-y-4">
          
          {/* Remaining Purse */}
          {(() => {
            const activeBidder = selectedBidderForBid 
              ? bidders.find(b => b.id === selectedBidderForBid)
              : userBidder
            
            if (!activeBidder) return null
            
            return (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                <div className="text-sm text-gray-700 dark:text-gray-300">Remaining Purse</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(activeBidder.remainingPurse)}
                </div>
              </div>
            )
          })()}
          
          {/* Current Bid */}
          {currentBid && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
              <div className="text-sm text-gray-700 dark:text-gray-300">Current Bid</div>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                {formatCurrency(currentBid.amount)}
              </div>
            </div>
          )}
          
          {/* Error Display */}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded">
              {error}
            </div>
          )}
          
          {/* Custom Amount Input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Total Bid Amount (₹)</Label>
            <Input
              type="number"
              placeholder="Enter total bid amount"
              value={bidAmount || ''}
              onChange={(e) => {
                setBidAmount(Number(e.target.value))
                setError('')
              }}
              className="text-lg font-semibold"
            />
            <p className="text-xs text-gray-500">
              {(() => {
                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as any
                const minInc = (rules?.minBidIncrement || 1000)
                return `Current: ₹${currentBidAmount.toLocaleString('en-IN')} • Minimum: ₹${(currentBidAmount + minInc).toLocaleString('en-IN')} • Must be in multiples of ₹1,000`
              })()}
            </p>
          </div>
          
          {/* Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => {
                setCustomBidModalOpen(false)
                setError('')
                setBidAmount(0)
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={async () => {
                // Determine which bidder to use (admin selected or user's own)
                const activeBidder = selectedBidderForBid 
                  ? bidders.find(b => b.id === selectedBidderForBid)
                  : userBidder
                
                if (!activeBidder || !bidAmount) return

                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = (rules?.minBidIncrement || 1000)
                const totalBid = bidAmount
                const difference = totalBid - currentBidAmount

                if (totalBid <= currentBidAmount) {
                  showBidError('Bid must exceed current amount')
                  return
                }

                // For custom bids, only check:
                // 1. Must be at least minIncrement more than current bid
                // 2. Must be in multiples of ₹1,000 (not increment)
                if (difference < minIncrement) {
                  showBidError(`Bid must be at least ₹${(currentBidAmount + minIncrement).toLocaleString('en-IN')}`)
                  return
                }

                if (totalBid % 1000 !== 0) {
                  showBidError('Bid must be in multiples of ₹1,000')
                  return
                }

                if (totalBid > activeBidder.remainingPurse) {
                  showBidError('Insufficient remaining purse')
                  return
                }

                // Optimistic UI updates - batched together
                // Use current state for rollback, but calculate optimistic bid based on latest state
                const previousBid = currentBid
                const previousHighestBidderId = highestBidderId
                
                // Create unique optimistic entry ID to track and remove it later
                const optimisticEntryId = `optimistic-${Date.now()}-${Math.random()}`
                const optimisticEntry: BidHistoryEntry = {
                  type: 'bid',
                  bidderId: activeBidder.id,
                  amount: totalBid,
                  timestamp: new Date(),
                  bidderName: activeBidder.user?.name || activeBidder.username,
                  teamName: activeBidder.teamName || undefined,
                  playerId: currentPlayer?.id,
                  // Add unique identifier for tracking
                  _optimisticId: optimisticEntryId
                } as any

                // Batch all state updates (React 18 auto-batches)
                setIsPlacingBid(true)
                setError('')
                setCurrentBid({
                  bidderId: activeBidder.id,
                  amount: totalBid,
                  bidderName: activeBidder.user?.name || activeBidder.username,
                  teamName: activeBidder.teamName || undefined
                })
                setHighestBidderId(activeBidder.id)
                setFullBidHistory(prev => [optimisticEntry, ...prev])

                // Fire-and-forget API call - don't block UI
                fetch(`/api/auction/${auction.id}/bid`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bidderId: activeBidder.id,
                    amount: totalBid
                  })
                })
                  .then(async (response) => {
                    if (!response.ok) {
                      const data = await response.json()
                      showBidError(data.error || 'Failed to place bid')
                      // Revert optimistic update - remove by unique ID
                      setCurrentBid(previousBid)
                      setHighestBidderId(previousHighestBidderId)
                      setFullBidHistory(prev => prev.filter(entry => 
                        (entry as any)._optimisticId !== optimisticEntryId
                      ))
                    } else {
                      // Success - close modal and clear form (non-blocking)
                      startTransition(() => {
                        setBidAmount(0)
                        setCustomBidModalOpen(false)
                        setSelectedBidderForBid(null)
                      })
                      toast.success('Bid placed successfully!')
                    }
                  })
                  .catch(() => {
                    showBidError('Network error. Please try again.')
                    // Revert optimistic update - remove by unique ID
                    setCurrentBid(previousBid)
                    setHighestBidderId(previousHighestBidderId)
                    setFullBidHistory(prev => prev.filter(entry => 
                      (entry as any)._optimisticId !== optimisticEntryId
                    ))
                  })
                  .finally(() => {
                    setIsPlacingBid(false)
                  })
              }}
              disabled={isPlacingBid || bidAmount === 0}
            >
              {isPlacingBid ? 'Placing...' : 'Place Bid'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Sliding Bidding Console (Admin only) */}
    {viewMode === 'admin' && (
      showPinnedConsole ? (
        <div className="hidden lg:flex fixed right-0 top-0 h-full w-[30%] z-40">
          <BidConsolePanel
            bidders={sortedBidders}
            highestBidderId={highestBidderId}
            currentBid={currentBid}
            isPlacingBid={isPlacingBid}
            minIncrement={(auction.rules as AuctionRules)?.minBidIncrement || 1000}
            selectedAmount={consoleSelectedAmount}
            selectedBidderId={consoleSelectedBidderId}
            customInput={consoleCustomInput}
            onSelectAmount={handleConsoleSelectAmount}
            onSelectBidder={setConsoleSelectedBidderId}
            onCustomInputChange={handleConsoleCustomInput}
            onConfirm={confirmConsoleBid}
          />
        </div>
      ) : (
        <div className={`${isBidConsoleOpen ? 'fixed' : 'hidden'} inset-0 z-50`}>
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setIsBidConsoleOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full sm:w-2/3 lg:w-[30%]">
            <BidConsolePanel
              bidders={sortedBidders}
              highestBidderId={highestBidderId}
              currentBid={currentBid}
              isPlacingBid={isPlacingBid}
              minIncrement={(auction.rules as AuctionRules)?.minBidIncrement || 1000}
              selectedAmount={consoleSelectedAmount}
              selectedBidderId={consoleSelectedBidderId}
              customInput={consoleCustomInput}
              onSelectAmount={handleConsoleSelectAmount}
              onSelectBidder={setConsoleSelectedBidderId}
              onCustomInputChange={handleConsoleCustomInput}
              onConfirm={confirmConsoleBid}
              showClose={true}
              onClose={() => setIsBidConsoleOpen(false)}
            />
          </div>
        </div>
      )
    )}

    {/* Undo Sale Dialog */}
    <AlertDialog open={undoSaleDialogOpen} onOpenChange={setUndoSaleDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Undo Last Action?</AlertDialogTitle>
          <AlertDialogDescription>
            This will revert whichever happened most recently - a sale (restoring the player and refunding the bidder) or marking a player unsold (putting them back on the block). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleUndoSaleConfirm} className="bg-red-600 hover:bg-red-700 text-white">
            Undo Action
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

