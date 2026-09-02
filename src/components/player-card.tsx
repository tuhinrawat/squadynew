"use client"

import { ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'

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
}

export default function PlayerCard({ name, imageUrl, tags = [], fields = [], basePrice, profileLink, currentBid }: PlayerCardProps) {
	// Extract field values
	const speciality = fields.find(f => f.label === 'Speciality')?.value || ''
	const batting = fields.find(f => f.label === 'Batting')?.value || ''
	const bowling = fields.find(f => f.label === 'Bowling')?.value || ''
	const wicketKeeper = fields.find(f => f.label === 'Wicket Keeper')?.value || ''

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

				{/* Secondary player facts - ticker-style row with thin dividers.
				    Grid + break-words (not truncate) so a longer value (e.g.
				    "Right Arm Medium Pace") always shows in full, on any width. */}
				{(batting || bowling || wicketKeeper) && (
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 py-3 border-y border-white/10 mb-3 sm:mb-5">
						{batting && (
							<div className="min-w-0 sm:text-center">
								<div className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest">Batting</div>
								<div className="text-xs sm:text-sm font-bold text-gray-100 uppercase break-words mt-0.5">{batting}</div>
							</div>
						)}
						{wicketKeeper && (
							<div className="min-w-0 sm:text-center sm:border-l sm:border-white/10 sm:pl-4 sm:order-3">
								<div className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest">Keeper</div>
								<div className="text-xs sm:text-sm font-bold text-gray-100 uppercase break-words mt-0.5">{wicketKeeper}</div>
							</div>
						)}
						{bowling && (
							<div className="min-w-0 col-span-2 sm:col-span-1 sm:order-2 sm:text-center sm:border-l sm:border-white/10 sm:pl-4 pt-3 sm:pt-0 border-t border-white/10 sm:border-t-0">
								<div className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest">Bowling</div>
								<div className="text-xs sm:text-sm font-bold text-gray-100 uppercase break-words mt-0.5">{bowling}</div>
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
		</div>
	)
}
