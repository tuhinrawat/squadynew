"use client"

import { ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { PlayerStatsDialog } from '@/components/player-stats-dialog'
import { StatTile } from '@/components/cricket-stat-ui'
import { BattingStats, BowlingStats } from '@/lib/cricket-stats'

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
	// The permanent auction number assigned via "Assign Serial Number" on
	// Manage Players - the same number printed on the physical plaque the
	// team hands the winning bidder, so it needs to read clearly at a glance.
	serialNumber?: number | null
	// Shrinks the photo zone and tightens spacing - the admin console's own
	// use of this card cares about the bid/price numbers, not a large photo,
	// unlike the public/presenter stage where the photo IS the point.
	compact?: boolean
	// Skips the batting/bowling panels entirely - admin doesn't need career
	// stats to run the auction, and dropping them (rather than just shrinking
	// them) is what actually saves the vertical space compact mode is for.
	hideStats?: boolean
}

export default function PlayerCard({ name, imageUrl, tags = [], fields = [], basePrice, profileLink, currentBid, lastYear, battingStats, bowlingStats, serialNumber, compact = false, hideStats = false }: PlayerCardProps) {
	// Extract field values
	const speciality = fields.find(f => f.label === 'Speciality')?.value || ''
	const battingStyle = fields.find(f => f.label === 'Batting')?.value || ''
	const bowlingStyle = fields.find(f => f.label === 'Bowling')?.value || ''
	// From the club's Google Form intake survey - see the exact question text
	// each alias matches against in the callers' `fields` builders.
	const ability = fields.find(f => f.label === 'Ability')?.value || ''
	const lastPlayed = fields.find(f => f.label === 'Last Played')?.value || ''
	const plays = fields.find(f => f.label === 'Plays')?.value || ''

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

			{/* Photo zone - full-bleed, not circular. Mobile's height was 220px,
			    which starved a typical tall/portrait event photo (see the
			    object-contain reasoning below) down to a narrow strip with most
			    of the frame's width sitting empty on either side of it - taller
			    now so the same photo renders visibly bigger without touching the
			    "never crop" guarantee. */}
			<div className={`relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 ${compact ? 'h-[110px] sm:h-[150px]' : 'h-[300px] sm:h-[340px] lg:h-[400px]'}`}>
				{/* Auction number plaque - the same number the team hands the
				    winning bidder on a physical placard, so it has to read as
				    the biggest, boldest thing on the card after the photo
				    itself, not a quiet detail. */}
				{serialNumber != null && (
					<div className={`absolute z-20 flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 border-white/90 shadow-xl ${compact ? 'top-2 left-2 w-8 h-8 border-2' : 'top-3 left-3 sm:top-4 sm:left-4 w-14 h-14 sm:w-20 sm:h-20 border-2 sm:border-[3px]'}`}>
						<span className={`font-black text-[#1a1200] tabular-nums leading-none ${compact ? 'text-sm' : 'text-2xl sm:text-4xl'}`}>{serialNumber}</span>
					</div>
				)}
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
						<span className={`font-black text-white/70 ${compact ? 'text-4xl sm:text-5xl' : 'text-8xl sm:text-9xl'}`}>{name.charAt(0).toUpperCase()}</span>
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
			<div className={compact ? 'relative p-2 sm:p-3' : 'relative p-3 sm:p-6 lg:p-8'}>
				{/* Current Bid Banner - always the first thing visible, no scrolling required */}
				{currentBid !== undefined && (
					// Amber, not teal - teal is now the site's general accent
					// (Batting/Bowling headers, Refresh button, etc.), so the one
					// number people are actually here to watch needs its own
					// distinct color to stand out from the rest of the card.
					// Pulses only while there's an actual bid to draw the eye to a
					// change - an empty "No bids yet" state has nothing urgent to
					// signal, so it stays still.
					<div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 ${compact ? 'mb-2' : 'mb-3 sm:mb-5'} ${currentBid ? 'animate-pulse' : ''}`}>
						<span className="text-[9px] sm:text-xs font-bold uppercase tracking-wider text-amber-300/80">Current Bid</span>
						{currentBid ? (
							<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 justify-end">
								<span className="text-base sm:text-2xl font-black text-amber-400 tabular-nums">₹{currentBid.amount.toLocaleString('en-IN')}</span>
								<span className="text-[10px] sm:text-sm font-bold text-white">{currentBid.bidderName}</span>
								{currentBid.teamName && (
									<span className="text-[9px] sm:text-[10px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full">{currentBid.teamName}</span>
								)}
							</div>
						) : (
							<span className="text-xs sm:text-sm font-semibold text-gray-500">No bids yet</span>
						)}
					</div>
				)}

				{/* Name */}
				<h2 className={`font-black text-white uppercase tracking-tight leading-tight ${compact ? 'text-base sm:text-xl' : 'text-xl sm:text-3xl lg:text-4xl'}`}>
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

				{/* Role pill + batting/bowling hand - replaces the old plain
				    Speciality label with the same "All-rounder · Right Handed ·
				    Right Arm Medium Pace" identity line used across the rest of
				    the redesigned stats section below. */}
				{(speciality || battingStyle || bowlingStyle) && (
					<div className={`flex flex-wrap items-center gap-2 mt-1.5 ${compact ? 'mb-2' : 'mb-2 sm:mb-3'}`}>
						{speciality && (
							<span className="inline-flex px-2.5 py-1 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-300 text-[10px] sm:text-xs font-bold uppercase tracking-wide">
								{speciality}
							</span>
						)}
						{(battingStyle || bowlingStyle) && (
							<span className="text-[10px] sm:text-xs text-gray-400 font-medium">
								{[battingStyle, bowlingStyle].filter(Boolean).join('  ·  ')}
							</span>
						)}
					</div>
				)}

				{/* Base price - its own line now that Speciality moved into the
				    role pill above. */}
				{basePrice !== undefined && (
					<div className={compact ? 'mb-2' : 'mb-3 sm:mb-5'}>
						<span className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wide">
							Base <span className="text-gray-200 font-bold tabular-nums">₹{basePrice.toLocaleString('en-IN')}</span>
						</span>
					</div>
				)}

				{/* Batting / Bowling career stat panels - side by side, always
				    visible. Each shows the four numbers that actually decide how
				    good a player is (see src/lib/cricket-stats.ts) as plain big
				    numbers rather than a "how good is this" scale bar - easier
				    to read at a glance, and consistent with the same panel style
				    used on the presenter stage (public-auction-view.tsx). A panel
				    only renders when the player has that discipline's data at
				    all; a pure batter gets one full-width panel with no Bowling
				    panel beside it. */}
				{!hideStats && (battingStats || bowlingStats) && (
					<div className={`grid gap-3 mb-3 sm:mb-5 ${battingStats && bowlingStats ? 'grid-cols-2' : 'grid-cols-1'}`}>
						{battingStats && (
							<div className="bg-white/[0.03] border border-white/[0.08] rounded-lg p-3 sm:p-4">
								<span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-teal-400">Batting</span>
								<div className="grid grid-cols-2 gap-2 sm:gap-3 mt-2.5 sm:mt-3">
									{battingStats.matches !== undefined && <StatTile label="Matches" value={battingStats.matches} />}
									{battingStats.runs !== undefined && <StatTile label="Runs" value={battingStats.runs} />}
									{battingStats.average !== undefined && <StatTile label="Average" value={battingStats.average.toFixed(2)} />}
									{battingStats.strikeRate !== undefined && <StatTile label="Strike Rate" value={battingStats.strikeRate.toFixed(2)} />}
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
								<span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-teal-400">Bowling</span>
								<div className="grid grid-cols-2 gap-2 sm:gap-3 mt-2.5 sm:mt-3">
									{bowlingStats.matches !== undefined && <StatTile label="Matches" value={bowlingStats.matches} />}
									{bowlingStats.wickets !== undefined && <StatTile label="Wickets" value={bowlingStats.wickets} />}
									{bowlingStats.economy !== undefined && <StatTile label="Economy" value={bowlingStats.economy.toFixed(2)} />}
									{bowlingStats.average !== undefined && <StatTile label="Average" value={bowlingStats.average.toFixed(2)} />}
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

				{/* Ability / Last played / Plays - from the club's intake survey
				    (see the `fields` extraction above). Only renders when the
				    player actually has at least one of these three answers. */}
				{!hideStats && (ability || lastPlayed || plays) && (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 sm:mb-5 text-[10px] sm:text-xs text-gray-400">
						{ability && <span><span className="font-bold text-gray-200">Ability:</span> {ability}</span>}
						{lastPlayed && <span><span className="font-bold text-gray-200">Last played:</span> {lastPlayed}</span>}
						{plays && <span><span className="font-bold text-gray-200">Plays:</span> {plays}</span>}
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
