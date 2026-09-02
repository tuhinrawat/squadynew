"use client"

import { ReactNode } from 'react'
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

	return (
		<div className="relative rounded-xl overflow-hidden w-full max-w-4xl mx-auto font-['Montserrat']">
			{/* Dynamic Background: Player Photo with 50% Transparency - Positioned Right */}
			{imageUrl ? (
				<div className="absolute inset-0 z-0 flex items-center justify-end bg-gray-900">
					<div className="w-1/2 h-full flex items-center justify-center">
						<img
							src={imageUrl}
							alt={`${name} Background`}
							className="max-w-full max-h-full object-contain opacity-50"
						/>
					</div>
					{/* Dark overlay for better text readability */}
					<div className="absolute inset-0 bg-gradient-to-br from-gray-900/80 via-gray-800/70 to-gray-900/80"></div>
				</div>
			) : (
				<div className="absolute inset-0 z-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900"></div>
			)}

		{/* Content */}
		<div className="relative z-10 p-3 sm:p-8 lg:p-10">
			{/* Current Bid Banner - always the first thing visible, no scrolling required */}
			{currentBid !== undefined && (
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-2.5 mb-3 sm:mb-6">
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

			{/* Player Name at Top */}
			<div className="mb-2 sm:mb-6">
				<h2 className="text-xl sm:text-4xl lg:text-5xl font-black text-white uppercase tracking-tight leading-tight">
					{name}
				</h2>
				<div className="w-12 sm:w-20 h-0.5 sm:h-1 bg-white mt-1 sm:mt-4"></div>
			</div>

			{/* Speciality Section */}
			{speciality && (
				<div className="mb-2 sm:mb-8">
					<div className="flex items-center gap-2 sm:gap-3">
						<span className="text-[10px] sm:text-sm font-semibold text-white uppercase tracking-widest">SPECIALITY</span>
						<span className="text-sm sm:text-xl lg:text-2xl font-black text-white uppercase">{speciality}</span>
					</div>
				</div>
			)}

			{/* Player Image */}
			<div className="flex flex-col items-center gap-2 sm:gap-3 mb-3 sm:mb-6">
				<div className="relative w-40 h-40 sm:w-80 sm:h-80 lg:w-96 lg:h-96">
						{imageUrl ? (
							<div className="w-full h-full rounded-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center border-4 border-teal-500/50 shadow-[0_0_0_6px_rgba(20,184,166,0.08)] overflow-hidden">
								<img
									src={imageUrl}
									alt={name}
									className="w-full h-full object-contain"
									onError={(e) => {
										// If image fails to load, hide it and show initials
										e.currentTarget.style.display = 'none'
										const parent = e.currentTarget.parentElement
										if (parent) {
											parent.innerHTML = `<span class="text-8xl sm:text-9xl font-black text-white/80">${name.charAt(0).toUpperCase()}</span>`
										}
									}}
								/>
							</div>
						) : (
							<div className="w-full h-full rounded-full bg-gradient-to-br from-blue-300 via-sky-200 to-green-300 flex items-center justify-center border-4 border-teal-500/50 shadow-[0_0_0_6px_rgba(20,184,166,0.08)]">
								<span className="text-8xl sm:text-9xl font-black text-white/80">{name.charAt(0).toUpperCase()}</span>
							</div>
						)}
					</div>

				{/* Cricheroes Profile Link */}
				{profileLink && (
					<a
						href={profileLink}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] sm:text-sm font-semibold rounded-lg transition-colors duration-200 border border-white/30"
					>
						Cricheroes.com
					</a>
				)}
			</div>

			{/* Secondary player facts strip - demoted tier. Label stacked above
			    value with wrapping instead of truncation, so a longer value
			    (e.g. "Right Arm Medium Pace") always shows in full. */}
			{(batting || bowling || wicketKeeper) && (
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 px-3 py-3 sm:px-4 sm:py-3.5 bg-white/[0.03] border border-white/10 rounded-lg mb-3 sm:mb-6">
					{batting && (
						<div className="min-w-0 sm:text-center">
							<div className="text-[10px] sm:text-xs font-semibold text-white/50 uppercase tracking-wider">Batting</div>
							<div className="text-xs sm:text-sm font-bold text-gray-200 uppercase break-words">{batting}</div>
						</div>
					)}
					{bowling && (
						<div className="min-w-0 sm:text-center sm:border-l sm:border-white/10 sm:pl-4">
							<div className="text-[10px] sm:text-xs font-semibold text-white/50 uppercase tracking-wider">Bowling</div>
							<div className="text-xs sm:text-sm font-bold text-gray-200 uppercase break-words">{bowling}</div>
						</div>
					)}
					{wicketKeeper && (
						<div className="min-w-0 sm:text-center sm:border-l sm:border-white/10 sm:pl-4">
							<div className="text-[10px] sm:text-xs font-semibold text-white/50 uppercase tracking-wider">Keeper</div>
							<div className="text-xs sm:text-sm font-bold text-gray-200 uppercase break-words">{wicketKeeper}</div>
						</div>
					)}
				</div>
			)}

			{/* Tags */}
			{tags.length > 0 && (
				<div className="flex flex-wrap gap-2 justify-center mb-2">
					{tags.map((t, i) => (
						<Badge key={i} className="bg-white/20 text-white font-semibold text-xs px-3 py-1">
							{t.label}
						</Badge>
					))}
				</div>
			)}
			</div>

			{/* Base Price - Bottom Right Corner */}
			{basePrice !== undefined && (
				<div className="absolute bottom-3 right-3 sm:bottom-6 sm:right-6 text-right z-10">
					<span className="text-[9px] sm:text-xs text-white/60 uppercase tracking-wider block">Base Price</span>
					<span className="text-base sm:text-3xl font-black text-white">₹{basePrice / 1000}k</span>
				</div>
			)}
		</div>
	)
}
