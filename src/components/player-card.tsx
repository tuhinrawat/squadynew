"use client"

import { ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { PlayerStatsDialog } from '@/components/player-stats-dialog'
import { BatIcon, BallIcon, ScaleBar } from '@/components/cricket-stat-ui'
import {
	BattingStats,
	BowlingStats,
	BATTING_AVERAGE_RANGE,
	BATTING_STRIKE_RATE_RANGE,
	BOWLING_ECONOMY_RANGE,
	BOWLING_AVERAGE_RANGE,
	scalePercent,
} from '@/lib/cricket-stats'

export interface PlayerCardProps {
	name: string
	imageUrl?: string | null
	tags?: Array<{ label: string; color?: 'purple' | 'blue' | 'green' }>
	fields?: Array<{ label: string; value: ReactNode }>
	isLoading?: boolean
	basePrice?: number
	profileLink?: string | null
	// Pass to show a live "current bid" banner above the fold - the single
	// most important fact during a live auction, which previously only lived
	// in a separate strip below the photo that required scrolling to see
	// (worse on mobile, where it was pushed even further down).
	currentBid?: { amount: number; bidderName: string; teamName?: string } | null
	// Set when this player was matched to a sale in a linked previous
	// auction (see src/lib/auction-history.ts) - the anchor/bidders' only
	// reference point for what this player went for last time.
	lastYear?: { price: number; teamName?: string | null; auctionName?: string | null } | null
	// Career stats from the uploaded player data (see src/lib/cricket-stats.ts).
	// Each panel only renders when its stats object is present, and each
	// scale bar/tile only renders when that specific field has a value.
	battingStats?: BattingStats | null
	bowlingStats?: BowlingStats | null
}

export default function PlayerCard({ name, imageUrl, tags = [], fields = [], basePrice, profileLink, currentBid, lastYear, battingStats, bowlingStats }: PlayerCardProps) {
	// Extract field values
	const speciality = fields.find(f => f.label === 'Speciality')?.value || ''
	const battingStyle = fields.find(f => f.label === 'Batting')?.value || ''
	const bowlingStyle = fields.find(f => f.label === 'Bowling')?.value || ''

	const [openStats, setOpenStats] = useState<'batting' | 'bowling' | null>(null)

	// Real source photos are informal, arbitrary-aspect-ratio phone shots.
	// Rather than crop unpredictably, the full photo is always shown in full
	// (object-contain) with a blurred, scaled copy of the same photo filling
	// any leftover space - nothing is ever cropped or stretched.
	//
	// imageFailed must reset whenever a new player's photo comes in, or a
	// broken image on one player would incorrectly keep showing the fallback
	// for every player after them. Adjusting state during render (rather than
	// in a useEffect) is React's own recommended pattern for this exact case -
	// it avoids the extra "commit, then effect fires, then re-render" round
	// trip a useEffect-based reset would cause.
	const [imageFailed, setImageFailed] = useState(false)
	const [trackedImageUrl, setTrackedImageUrl] = useState(imageUrl)
	if (imageUrl !== trackedImageUrl) {
		setTrackedImageUrl(imageUrl)
		setImageFailed(false)
	}

	return (
		<div className="relative rounded-xl overflow-hidden w-full max-w-4xl mx-auto font-['Montserrat'] bg-[#0a0d12]">

			{/* Photo zone - full-bleed, not circular */}
			<div className="relative h-[220px] sm:h-[340px] lg:h-[400px] overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
				{imageUrl && !imageFailed ? (
					<>
						{/* Backdrop layer: same photo, blurred + scaled to fill the frame */}
						<img
							src={imageUrl}
							alt=""
							aria-hidden="true"
							className="absolute inset-0 w-full h-full object-cover blur-2xl brightness-50 scale-125"
						/>
						{/* Foreground layer: the full, uncropped photo */}
						<div className="absolute inset-0 flex items-center justify-center">
							<img
								src={imageUrl}
								alt={name}
								className="max-w-full max-h-full object-contain"
								onError={() => setImageFailed(true)}
							/>
						</div>
					</>
				) : (
					<div className="absolute inset-0 flex items-center justify-center">
						<span className="text-8xl sm:text-9xl font-black text-white/70">{name.charAt(0).toUpperCase()}</span>
					</div>
				)}
				{/* Vignette - darkens the frame's edges so a narrow portrait
				    photo against the wide blurred backdrop reads as a lit
				    stage, not empty space around a small picture. */}
				<div
					className="absolute inset-0 pointer-events-none"
					style={{ boxShadow: 'inset 0 0 120px 40px rgba(0,0,0,0.55)' }}
				/>
				{/* Fade into the content section below */}
				<div className="absolute bottom-0 inset-x-0 h-16 sm:h-24 bg-gradient-to-t from-[#0a0d12] to-transparent pointer-events-none" />
			</div>

			{/* Content */}
			<div className="relative p-3 sm:p-6 lg:p-8">
				{/* Current Bid Banner - always the first thing visible, no scrolling required */}
				{currentBid !== undefined && (
					<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 mb-3 sm:mb-5">
						<span className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-teal-300/80">Current Bid</span>
						{currentBid ? (
							<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-end">
								<span className="text-base sm:text-2xl font-black text-teal-400 tabular-nums">₹{currentBid.amount.toLocaleString('en-IN')}</span>
								<span className="text-[10px] sm:text-sm font-bold text-white">{currentBid.bidderName}</span>
								{currentBid.teamName && (
									<span className="text-[9px] sm:text-[10px] font-bold text-teal-300 bg-teal-500/15 px-2 py-0.5 rounded-full">{currentBid.teamName}</span>
								)}
							</div>
						) : (
							<span className="text-xs sm:text-sm font-semibold text-gray-500">No bids yet</span>
						)}
					</div>
				)}

				{/* Name */}
				<h2 className="text-xl sm:text-3xl lg:text-4xl font-black text-white uppercase tracking-tight leading-tight">
					{name}
				</h2>

				{/* Last Year Price - only when this player was matched to a sale
				    in a linked previous auction (see auction-history.ts) */}
				{lastYear && (
					<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5">
						<span className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-400/90">Last Year Price</span>
						<span className="text-xs sm:text-sm font-black text-amber-300 tabular-nums">₹{lastYear.price.toLocaleString('en-IN')}</span>
						{lastYear.teamName && (
							<span className="text-[10px] sm:text-xs font-semibold text-gray-400">&middot; {lastYear.teamName}</span>
						)}
					</div>
				)}

				{/* Speciality + Base price */}
				{(speciality || basePrice !== undefined) && (
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 mb-3 sm:mb-5">
						{speciality && (
							<>
								<span className="text-[9px] sm:text-xs font-bold uppercase tracking-widest text-teal-400">{speciality}</span>
								{basePrice !== undefined && <span className="text-gray-600">&middot;</span>}
							</>
						)}
						{basePrice !== undefined && (
							<span className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wide">
								Base <span className="text-gray-200 font-bold tabular-nums">₹{basePrice.toLocaleString('en-IN')}</span>
							</span>
						)}
					</div>
				)}

				{/* Batting / Bowling career stat panels - side by side, always
				    visible. Each shows one career total plus the two metrics
				    that actually decide how good a player is (see
				    src/lib/cricket-stats.ts for why those two, not every
				    uploaded column) as "how good is this" scale bars, not a
				    raw number dump. A panel only renders when the player has
				    that discipline's data at all; a pure batter gets one
				    full-width panel with no Bowling panel beside it. */}
				{(battingStats || bowlingStats) && (
					<div className={`grid gap-3 mb-3 sm:mb-5 ${battingStats && bowlingStats ? 'grid-cols-2' : 'grid-cols-1'}`}>
						{battingStats && (
							<div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-3 sm:p-4">
								<div className="flex items-start justify-between mb-3 sm:mb-4">
									<div className="flex items-center gap-1.5">
										<BatIcon />
										<span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-teal-400">Batting</span>
									</div>
									{battingStats.runs !== undefined && (
										<div className="text-right leading-none">
											<span className="text-lg sm:text-xl font-black text-white tabular-nums">{battingStats.runs}</span>
											<div className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-gray-500 mt-0.5">Runs</div>
										</div>
									)}
								</div>
								<div className="space-y-3">
									{battingStats.average !== undefined && (
										<ScaleBar label="Average" value={scalePercent(battingStats.average, BATTING_AVERAGE_RANGE)} formatted={battingStats.average.toFixed(2)} />
									)}
									{battingStats.strikeRate !== undefined && (
										<ScaleBar label="Strike Rate" value={scalePercent(battingStats.strikeRate, BATTING_STRIKE_RATE_RANGE)} formatted={battingStats.strikeRate.toFixed(2)} />
									)}
								</div>
								<button
									type="button"
									onClick={() => setOpenStats('batting')}
									className="inline-flex items-center gap-1 mt-3 sm:mt-3.5 text-teal-300 text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider"
								>
									View More
									<svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
								</button>
							</div>
						)}

						{bowlingStats && (
							<div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-3 sm:p-4">
								<div className="flex items-start justify-between mb-3 sm:mb-4">
									<div className="flex items-center gap-1.5">
										<BallIcon />
										<span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-teal-400">Bowling</span>
									</div>
									{bowlingStats.wickets !== undefined && (
										<div className="text-right leading-none">
											<span className="text-lg sm:text-xl font-black text-white tabular-nums">{bowlingStats.wickets}</span>
											<div className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-gray-500 mt-0.5">Wickets</div>
										</div>
									)}
								</div>
								<div className="space-y-3">
									{bowlingStats.economy !== undefined && (
										<ScaleBar label="Economy" value={scalePercent(bowlingStats.economy, BOWLING_ECONOMY_RANGE, true)} formatted={bowlingStats.economy.toFixed(2)} />
									)}
									{bowlingStats.average !== undefined && (
										<ScaleBar label="Average" value={scalePercent(bowlingStats.average, BOWLING_AVERAGE_RANGE, true)} formatted={bowlingStats.average.toFixed(2)} />
									)}
								</div>
								<button
									type="button"
									onClick={() => setOpenStats('bowling')}
									className="inline-flex items-center gap-1 mt-3 sm:mt-3.5 text-teal-300 text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider"
								>
									View More
									<svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
								</button>
							</div>
						)}
					</div>
				)}

				{/* Tags + profile link */}
				{(tags.length > 0 || profileLink) && (
					<div className="flex flex-wrap items-center gap-2">
						{tags.map((t, i) => (
							<Badge key={i} className="bg-white/10 text-white font-semibold text-xs px-3 py-1">
								{t.label}
							</Badge>
						))}
						{profileLink && (
							<a
								href={profileLink}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white text-[10px] sm:text-xs font-semibold rounded-lg transition-colors duration-200 border border-white/15"
							>
								Cricheroes.com
							</a>
						)}
					</div>
				)}
			</div>

			<PlayerStatsDialog
				open={openStats === 'batting'}
				onOpenChange={(open) => setOpenStats(open ? 'batting' : null)}
				discipline="batting"
				battingStats={battingStats}
				styleText={battingStyle ? String(battingStyle) : undefined}
			/>
			<PlayerStatsDialog
				open={openStats === 'bowling'}
				onOpenChange={(open) => setOpenStats(open ? 'bowling' : null)}
				discipline="bowling"
				bowlingStats={bowlingStats}
				styleText={bowlingStyle ? String(bowlingStyle) : undefined}
			/>
		</div>
	)
}
