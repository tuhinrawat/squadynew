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
}

export default function PlayerCard({ name, imageUrl, tags = [], fields = [], basePrice, profileLink }: PlayerCardProps) {
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

			{/* Secondary player facts strip - demoted tier, overflow-safe */}
			{(batting || bowling || wicketKeeper) && (
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 px-3 py-2.5 sm:px-4 sm:py-3 bg-white/[0.03] border border-white/10 rounded-lg mb-3 sm:mb-6">
					{batting && (
						<div className="flex items-center gap-1.5 sm:justify-center min-w-0">
							<span className="text-[10px] sm:text-xs font-semibold text-white/50 uppercase tracking-wider flex-shrink-0">Batting</span>
							<span className="text-xs sm:text-sm font-bold text-gray-200 uppercase truncate">{batting}</span>
						</div>
					)}
					{bowling && (
						<div className="flex items-center gap-1.5 sm:justify-center min-w-0 sm:border-l sm:border-white/10 sm:pl-4">
							<span className="text-[10px] sm:text-xs font-semibold text-white/50 uppercase tracking-wider flex-shrink-0">Bowling</span>
							<span className="text-xs sm:text-sm font-bold text-gray-200 uppercase truncate">{bowling}</span>
						</div>
					)}
					{wicketKeeper && (
						<div className="flex items-center gap-1.5 sm:justify-center min-w-0 sm:border-l sm:border-white/10 sm:pl-4">
							<span className="text-[10px] sm:text-xs font-semibold text-white/50 uppercase tracking-wider flex-shrink-0">Keeper</span>
							<span className="text-xs sm:text-sm font-bold text-gray-200 uppercase truncate">{wicketKeeper}</span>
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
