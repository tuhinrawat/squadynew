"use client"

import { Trophy } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export interface BidAmountStripProps {
	amount: number | null
	bidderName?: string | null
	teamName?: string | null
	timerSeconds?: number
	nextMin?: number
	auctionId?: string
}

export default function BidAmountStrip({ amount, bidderName, teamName, auctionId }: BidAmountStripProps) {
	return (
		<div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-100 dark:border-blue-900 p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="flex-1 min-w-0">
					<div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Current Bid</div>
					{amount != null ? (
						<div className="space-y-1">
							<div className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">₹{amount.toLocaleString('en-IN')}</div>
							{bidderName && (
								<div className="text-xs sm:text-sm text-gray-700 dark:text-gray-200 font-semibold truncate">
									{bidderName}
									{teamName && <span className="text-blue-600 font-bold"> ({teamName})</span>}
								</div>
							)}
						</div>
					) : (
						<div className="text-gray-400 text-sm">No bids yet</div>
					)}
				</div>
				{auctionId && (
					<Link href={`/auction/${auctionId}/teams`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
						<Button className="relative group bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-white shadow-[0_2px_12px_rgba(79,70,229,0.35)] hover:shadow-[0_3px_16px_rgba(79,70,229,0.5)] h-11 px-3 rounded-lg border border-white/20 transition-all duration-300 hover:scale-105 active:scale-95" size="sm">
							{/* Glossy overlay */}
							<div className="absolute inset-0 rounded-lg bg-gradient-to-b from-white/15 to-transparent opacity-50 group-hover:opacity-70 transition-opacity" />
							{/* Content */}
							<div className="relative flex items-center gap-1.5">
								<Trophy className="h-3.5 w-3.5 drop-shadow-md" />
								<span className="hidden sm:inline text-xs font-semibold">All Players & Teams</span>
								<span className="sm:hidden text-xs font-semibold">Teams</span>
							</div>
							{/* Shine effect on hover */}
							<div className="absolute inset-0 rounded-lg overflow-hidden">
								<div className="absolute inset-0 translate-x-[-100%] group-hover:translate-x-[100%] bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700" />
							</div>
						</Button>
					</Link>
				)}
			</div>
		</div>
	)
}
