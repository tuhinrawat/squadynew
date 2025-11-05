"use client"

import { memo } from 'react'
import { Clock } from 'lucide-react'

export type ActivityLogEntry = {
	// Common
	timestamp: Date | string
	type?: 'bid' | 'sold' | 'unsold'
	// Bid
	bidderId?: string
	bidderName?: string
	teamName?: string
	amount?: number
	// Player context
	playerId?: string
	playerName?: string
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
		const now = new Date()
		const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000))
		if (diffSec < 60) return `${diffSec}s ago`
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
					return (
                        <li
                            key={idx}
                            className={`py-2 px-3 flex items-start gap-3 rounded-xl border
                                ${isSold
                                    ? 'bg-green-50/70 dark:bg-green-900/10 border-green-200/70 dark:border-green-900/30'
                                    : isUnsold
                                    ? 'bg-orange-50/70 dark:bg-orange-900/10 border-orange-200/70 dark:border-orange-900/30'
                                    : 'bg-white/60 dark:bg-gray-900/20 border-gray-200/60 dark:border-gray-800/60 hover:bg-blue-50/40 dark:hover:bg-blue-900/10'}
                                ${idx === 0 && isBid ? 'shadow-sm ring-1 ring-blue-200/60 dark:ring-blue-900/30' : ''}
                            `}
                        >
							{/* Avatar placeholder with initial */}
							<div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${isSold ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : isUnsold ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
								{(it.bidderName || it.playerName || '•').charAt(0).toUpperCase()}
							</div>
							<div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span className="font-semibold text-gray-900 dark:text-gray-100 whitespace-normal break-words">
										{isBid ? (it.bidderName ?? 'Bid') : (it.playerName ?? '')}
									</span>
									{isBid && (
										<>
											<span className="text-gray-500 dark:text-gray-400">placed</span>
                                            <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold">
                                                ₹{(it.amount ?? 0).toLocaleString('en-IN')}
                                            </span>
                                            {it.teamName && (
                                                <span className="text-gray-500 dark:text-gray-400">for</span>
                                            )}
                                            {it.teamName && (
                                                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 whitespace-normal break-words">
                                                    {it.teamName}
                                                </span>
                                            )}
										</>
									)}
									{isSold && (
                                        <span className="px-2 py-0.5 rounded-md bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-semibold">SOLD</span>
									)}
									{isUnsold && (
                                        <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 font-semibold">UNSOLD</span>
									)}
								</div>
								{/* Secondary line */}
                                <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2 mt-0.5">
									{isSold && (
										<>
											<span>to</span>
											<span className="font-medium">{it.bidderName}</span>
											{it.teamName && <span className="text-gray-500 dark:text-gray-400">({it.teamName})</span>}
											<Amount value={it.amount} />
										</>
									)}
									{isUnsold && (
										<span>No buyer • moving to next player</span>
									)}
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
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span>{time}</span>
                                </div>
                            </div>
						</li>
					)
				})}
			</ul>
		</div>
	)
})
