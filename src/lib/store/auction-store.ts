'use client'

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { AuctionState, AuctionActions, Player, Bidder, Bid } from '@/types/auction'

interface AuctionStore extends AuctionState, AuctionActions {}

const initialState: AuctionState = {
  currentPlayer: null,
  currentBid: null,
  timer: 0,
  bidHistory: [],
  bidders: [],
  isPaused: false,
  isEnded: false,
}

export const useAuctionStore = create<AuctionStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        setCurrentPlayer: (player: Player | null) => {
          set({ currentPlayer: player }, false, 'setCurrentPlayer')
        },

        updateBid: (bid: {
          bidderId: string
          amount: number
          bidderName: string
          teamName?: string
        } | null) => {
          set({ currentBid: bid }, false, 'updateBid')
        },

        updateTimer: (seconds: number) => {
          set({ timer: seconds }, false, 'updateTimer')
        },

        addToBidHistory: (bid: Bid) => {
          set(
            (state) => ({
              bidHistory: [...state.bidHistory, bid],
            }),
            false,
            'addToBidHistory'
          )
        },

        resetTimer: () => {
          set({ timer: 0 }, false, 'resetTimer')
        },

        setBidders: (bidders: Bidder[]) => {
          set({ bidders }, false, 'setBidders')
        },

        setBidHistory: (history: Bid[]) => {
          set({ bidHistory: history }, false, 'setBidHistory')
        },

        pauseAuction: () => {
          set({ isPaused: true }, false, 'pauseAuction')
        },

        resumeAuction: () => {
          set({ isPaused: false }, false, 'resumeAuction')
        },

        endAuction: () => {
          set({ isEnded: true, isPaused: false }, false, 'endAuction')
        },

        resetAuction: () => {
          set(initialState, false, 'resetAuction')
        },
      }),
      {
        name: 'auction-store',
        partialize: (state) => ({
          // Only persist certain parts of the state
          bidders: state.bidders,
          bidHistory: state.bidHistory,
        }),
      }
    ),
    {
      name: 'auction-store',
    }
  )
)

// Selectors for better performance
export const useCurrentPlayer = () => useAuctionStore((state) => state.currentPlayer)
export const useCurrentBid = () => useAuctionStore((state) => state.currentBid)
export const useTimer = () => useAuctionStore((state) => state.timer)
export const useBidHistory = () => useAuctionStore((state) => state.bidHistory)
export const useBidders = () => useAuctionStore((state) => state.bidders)
export const useAuctionStatus = () => useAuctionStore((state) => ({
  isPaused: state.isPaused,
  isEnded: state.isEnded,
}))

// Action selectors
export const useAuctionActions = () => useAuctionStore((state) => ({
  setCurrentPlayer: state.setCurrentPlayer,
  updateBid: state.updateBid,
  updateTimer: state.updateTimer,
  addToBidHistory: state.addToBidHistory,
  resetTimer: state.resetTimer,
  setBidders: state.setBidders,
  setBidHistory: state.setBidHistory,
  pauseAuction: state.pauseAuction,
  resumeAuction: state.resumeAuction,
  endAuction: state.endAuction,
  resetAuction: state.resetAuction,
}))
