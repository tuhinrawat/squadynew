"use client"

import { memo } from 'react'
import { Clock } from 'lucide-react'

export type ActivityLogEntry = {
	// Common
	timestamp: Date | string
	type?: 'bid' | 'sold' | 'unsold' | 'sale-undo'
	// Bid
	bidderId?: string
	bidderName?: string
	teamName?: string
	amount?: number
	// Player context
	playerId?: string
	playerName?: string
	// Sale undo
	refundedAmount?: number
}

export interface ActivityLogProps {
    items: ActivityLogEntry[]
    className?: string
    maxItems?: number
    // Optional admin action: undo the latest bid
    onUndoBid?: (entry: ActivityLogEntry) => void
}

function formatTime(ts: Date | string) {
	const d = typeof ts === 'string' ? new Date(ts) : ts
	try {
		const day = String(d.getDate()).padStart(2, '0')
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
		const month = months[d.getMonth()]
		const year = String(d.getFullYear()).slice(-2)
		const hours = String(d.getHours()).padStart(2, '0')
		const minutes = String(d.getMinutes()).padStart(2, '0')
		const seconds = String(d.getSeconds()).padStart(2, '0')
		return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`
	} catch {
		return ''
	}
}

function Amount({ value }: { value?: number }) {
	if (value == null) return null
	return <span className="font-semibold">₹{value.toLocaleString('en-IN')}</span>
}

export const ActivityLog = memo(function ActivityLog({ items, className, maxItems = 50, onUndoBid }: ActivityLogProps) {
	const trimmed = items.slice(0, maxItems)
	return (
        <div className={className ?? ''}>
            <ul className="divide-y divide-transparent space-y-1">
                {trimmed.map((it, idx) => {
					const time = formatTime(it.timestamp)
					const isBid = !it.type || it.type === 'bid'
					const isSold = it.type === 'sold'
					const isUnsold = it.type === 'unsold'
					const isSaleUndo = it.type === 'sale-undo'
					return (
                        <li
                            key={idx}
                            className={`py-2 px-3 flex items-start gap-3
                                ${isSold
                                    ? 'bg-green-50/70 dark:bg-green-900/10'
                                    : isUnsold
                                    ? 'bg-orange-50/70 dark:bg-orange-900/10'
                                    : isSaleUndo
                                    ? 'bg-purple-50/70 dark:bg-purple-900/10'
                                    : 'bg-white/60 dark:bg-gray-900/20 hover:bg-blue-50/40 dark:hover:bg-blue-900/10'}
                            `}
                        >
							{/* Avatar placeholder with initial */}
							<div className={`h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold ${
								isSold ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' 
								: isUnsold ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
								: isSaleUndo ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
								: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
							}`}>
								{(it.bidderName || it.playerName || '•').charAt(0).toUpperCase()}
							</div>
							<div className="min-w-0 flex-1">
                                {/* Main line - all info in one line */}
                                <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                                    <span className="font-semibold text-gray-900 dark:text-gray-100 whitespace-normal break-words">
										{isBid ? (it.bidderName ?? 'Bid') : isSaleUndo ? (it.playerName ?? 'Player') : (it.playerName ?? '')}
									</span>
									{isBid && (
										<>
											<span className="text-gray-500 dark:text-gray-400 hidden sm:inline">placed</span>
                                            <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold text-[11px] sm:text-xs">
                                                ₹{(it.amount ?? 0).toLocaleString('en-IN')}
                                            </span>
                                            {it.teamName && (
                                                <>
                                                    <span className="text-gray-500 dark:text-gray-400 hidden sm:inline">for</span>
                                                    <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-normal break-words text-[11px] sm:text-xs">
                                                        {it.teamName}
                                                    </span>
                                                </>
                                            )}
										</>
									)}
									{isSold && (
										<>
                                            <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-semibold text-[11px] sm:text-xs">SOLD</span>
											<span className="text-gray-500 dark:text-gray-400 hidden sm:inline">to</span>
											<span className="font-medium text-gray-900 dark:text-gray-100">{it.bidderName}</span>
											{it.teamName && <span className="text-gray-500 dark:text-gray-400">({it.teamName})</span>}
											<span className="font-semibold text-xs sm:text-sm">₹{(it.amount ?? 0).toLocaleString('en-IN')}</span>
										</>
									)}
									{isUnsold && (
                                        <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 font-semibold text-[11px] sm:text-xs">UNSOLD</span>
									)}
									{isSaleUndo && (
										<>
                                            <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-semibold text-[11px] sm:text-xs">SALE UNDONE</span>
											{it.refundedAmount && (
												<>
													<span className="text-gray-500 dark:text-gray-400 hidden sm:inline">refunded</span>
													<span className="font-semibold text-xs sm:text-sm">₹{it.refundedAmount.toLocaleString('en-IN')}</span>
												</>
											)}
										</>
									)}
								</div>
								{/* Timestamp line below */}
                                <div className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5 sm:mt-1">
                                    <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                    <span>{time}</span>
								</div>
							</div>
                            <div className="flex items-center gap-2 shrink-0 self-start">
                                {idx === 0 && isBid && onUndoBid && (
                                    <button
                                        className="text-[11px] px-2 py-1 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 shadow-sm"
                                        onClick={() => onUndoBid(it)}
                                        title="Undo last bid"
                                    >
                                        Undo
                                    </button>
                                )}
                            </div>
						</li>
					)
				})}
			</ul>
		</div>
	)
})
