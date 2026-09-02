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
	const initials = bidderName
		? bidderName.trim().split(/\s+/).map(part => part.charAt(0).toUpperCase()).slice(0, 2).join('')
		: null

	return (
		<div className="bg-gradient-to-br from-gray-900 via-[#1a2130] to-gray-900 rounded-xl p-4 sm:p-6">
			<div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 sm:px-8 sm:py-6">
				<div className="text-center">
					<div className="text-[10px] sm:text-xs uppercase tracking-widest font-bold text-gray-400 mb-1">Current Bid</div>
					{amount != null ? (
						<div className="text-3xl sm:text-5xl font-black text-teal-400 tabular-nums leading-none">₹{amount.toLocaleString('en-IN')}</div>
					) : (
						<div className="text-gray-500 text-sm font-semibold">No bids yet</div>
					)}
				</div>

				{amount != null && bidderName && (
					<>
						<div className="hidden sm:block w-px h-14 bg-white/10" />
						<div className="flex items-center gap-3 min-w-0">
							<div className="h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-teal-500/15 border-2 border-teal-500 flex items-center justify-center text-teal-300 font-extrabold text-sm flex-shrink-0">
								{initials}
							</div>
							<div className="min-w-0 text-left">
								<div className="text-white font-bold text-sm sm:text-base truncate">{bidderName}</div>
								{teamName && (
									<div className="inline-flex items-center gap-1 bg-teal-500/15 text-teal-300 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full mt-0.5">
										{teamName}
									</div>
								)}
							</div>
						</div>
					</>
				)}
			</div>

			{auctionId && (
				<div className="flex justify-center mt-4">
					<Link href={`/auction/${auctionId}/teams`} target="_blank" rel="noopener noreferrer">
						<Button className="bg-teal-600 hover:bg-teal-700 text-white h-10 px-4" size="sm">
							<Trophy className="h-4 w-4 mr-1.5" />
							All Players &amp; Teams
						</Button>
					</Link>
				</div>
			)}
		</div>
	)
}
