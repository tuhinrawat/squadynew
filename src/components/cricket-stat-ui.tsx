"use client"

import { ReactNode } from 'react'

// Small stroke-icon set + stat-display primitives shared between PlayerCard
// (the live-auction stage card), PlayerStatsDialog (the "View More" popup),
// and the Know Your Players grid cards - kept in one place so all three
// draw the same icon/typography language instead of drifting.

export function BatIcon({ size = 16, color = '#5eead4' }: { size?: number; color?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<g transform="rotate(40 12 12)">
				<rect x="10.5" y="2" width="3" height="8" rx="1.5"></rect>
				<rect x="9" y="10" width="6" height="12" rx="3"></rect>
			</g>
		</svg>
	)
}

export function BallIcon({ size = 16, color = '#5eead4' }: { size?: number; color?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="9"></circle>
			<path d="M12 3a9 9 0 0 1 0 18"></path>
		</svg>
	)
}

export function ScaleBar({ label, value, formatted }: { label: string; value: number; formatted: string }) {
	return (
		<div>
			<div className="flex items-baseline justify-between mb-1.5">
				<span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
				<span className="text-sm font-extrabold text-white tabular-nums">{formatted}</span>
			</div>
			<div className="relative h-1.5 rounded-full bg-white/10 overflow-hidden">
				<div className="absolute inset-y-0 left-0 rounded-full bg-teal-400" style={{ width: `${value}%` }} />
			</div>
		</div>
	)
}

// size="lg" is for the presenter stage specifically - a big screen viewed
// from across a room, where the default tile (sized for a dense grid card
// or a popup dialog) reads as a blur. Same visual language, scaled up:
// same border/background treatment, just bigger type and breathing room.
export function StatTile({ label, value, size = 'sm' }: { label: string; value: ReactNode; size?: 'sm' | 'lg' }) {
	if (size === 'lg') {
		return (
			<div className="bg-white/[0.04] border border-white/10 rounded-xl px-3 py-4 text-center">
				<div className="text-2xl lg:text-3xl font-black text-white tabular-nums">{value}</div>
				<div className="text-[11px] lg:text-xs font-bold uppercase tracking-wider text-gray-400 mt-1.5 leading-tight">{label}</div>
			</div>
		)
	}
	return (
		<div className="bg-white/[0.035] border border-white/[0.07] rounded-lg px-1.5 py-2.5 text-center">
			<div className="text-[15px] font-extrabold text-gray-100 tabular-nums">{value}</div>
			<div className="text-[8px] font-bold uppercase tracking-wider text-gray-500 mt-1 leading-tight">{label}</div>
		</div>
	)
}
