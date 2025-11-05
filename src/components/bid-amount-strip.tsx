"use client"

import { Clock } from 'lucide-react'

export interface BidAmountStripProps {
	amount: number | null
	bidderName?: string | null
	teamName?: string | null
	timerSeconds?: number
	nextMin?: number
}

export default function BidAmountStrip({ amount, bidderName, teamName, timerSeconds, nextMin }: BidAmountStripProps) {
	return (
		<div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-100 dark:border-blue-900 p-3 sm:p-4">
			<div className="flex items-center justify-between">
				<div>
					<div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Current Bid</div>
					{amount != null ? (
						<div className="flex items-center gap-2">
							<div className="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">₹{amount.toLocaleString('en-IN')}</div>
							{bidderName && (
								<div className="text-sm sm:text-base text-gray-700 dark:text-gray-200 font-semibold">
									{bidderName}
									{teamName && <span className="text-blue-600 font-bold"> ({teamName})</span>}
								</div>
							)}
						</div>
					) : (
						<div className="text-gray-400">No bids yet</div>
					)}
				</div>
				<div className="flex flex-col items-end gap-1">
					{typeof timerSeconds === 'number' && (
						<div className={`flex items-center gap-1 text-sm ${timerSeconds <= 5 ? 'text-red-600' : 'text-gray-700 dark:text-gray-300'}`}>
							<Clock className="h-4 w-4" />
							<span>{timerSeconds}s</span>
						</div>
					)}
					{typeof nextMin === 'number' && (
						<div className="text-xs text-gray-500 dark:text-gray-400">Min next: ₹{nextMin.toLocaleString('en-IN')}</div>
					)}
				</div>
			</div>
		</div>
	)
}
