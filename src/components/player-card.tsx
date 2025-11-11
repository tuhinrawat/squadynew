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

export default function PlayerCard({ name, imageUrl, tags = [], fields = [], isLoading, basePrice, profileLink }: PlayerCardProps) {
	// Extract field values
	const speciality = fields.find(f => f.label === 'Speciality')?.value || ''
	const batting = fields.find(f => f.label === 'Batting')?.value || ''
	const bowling = fields.find(f => f.label === 'Bowling')?.value || ''
	const fielding = fields.find(f => f.label === 'Fielding')?.value || ''
	
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
			
			{/* Decorative curved shapes on left side */}
			<div className="absolute left-0 top-0 bottom-0 w-32 opacity-30 z-[1]">
				<svg viewBox="0 0 100 400" className="w-full h-full">
					<path d="M 0 0 Q 50 100 0 200 Q 50 300 0 400 L 0 0 Z" fill="#555" opacity="0.5"/>
					<path d="M 20 0 Q 70 100 20 200 Q 70 300 20 400 L 20 0 Z" fill="#666" opacity="0.3"/>
				</svg>
			</div>
			
		{/* Content */}
		<div className="relative z-10 p-1 sm:p-8 lg:p-10">
			{/* Player Name at Top */}
			<div className="mb-1 sm:mb-6">
				<h2 className="text-xl sm:text-4xl lg:text-5xl font-black text-white uppercase tracking-tight leading-tight">
					{name}
				</h2>
				<div className="w-12 sm:w-20 h-0.5 sm:h-1 bg-white mt-1 sm:mt-4"></div>
			</div>
			
			{/* Speciality Section */}
			{speciality && (
				<div className="mb-1 sm:mb-8">
					<div className="flex items-center gap-2 sm:gap-3">
						<span className="text-[10px] sm:text-sm font-semibold text-white uppercase tracking-widest">SPECIALITY</span>
						<span className="text-sm sm:text-xl lg:text-2xl font-black text-white uppercase">{speciality}</span>
					</div>
				</div>
			)}
				
			{/* Player Image and Stats Side by Side */}
			<div className="flex flex-col lg:flex-row items-center lg:items-start gap-1 sm:gap-6 lg:gap-12 mb-1 sm:mb-8">
				{/* Player Image */}
				<div className="flex flex-col items-center lg:items-start">
					<div className="relative w-40 h-40 sm:w-96 sm:h-96 lg:w-[28rem] lg:h-[28rem] mb-2 sm:mb-3">
							{imageUrl ? (
								<div className="w-full h-full rounded-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center border-4 border-white/20 overflow-hidden">
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
								<div className="w-full h-full rounded-full bg-gradient-to-br from-blue-300 via-sky-200 to-green-300 flex items-center justify-center border-4 border-white/20">
									<span className="text-8xl sm:text-9xl font-black text-white/80">{name.charAt(0).toUpperCase()}</span>
								</div>
							)}
						</div>
						
					{/* Stats below image on mobile, hidden on desktop */}
					<div className="flex flex-col lg:hidden items-center gap-1 sm:gap-4 mt-1 sm:mt-4 w-full">
						{batting && (
							<div className="flex flex-col gap-0.5 sm:gap-1 items-center">
								<span className="text-[10px] sm:text-sm font-semibold text-white/70 uppercase tracking-widest">BATSMEN</span>
								<span className="text-sm sm:text-2xl font-black text-white uppercase">{batting}</span>
							</div>
						)}
						{bowling && (
							<div className="flex flex-col gap-0.5 sm:gap-1 items-center">
								<span className="text-[10px] sm:text-sm font-semibold text-white/70 uppercase tracking-widest">BOWLER</span>
								<span className="text-sm sm:text-2xl font-black text-white uppercase">{bowling}</span>
							</div>
						)}
						
					{/* Cricheros Profile Link - Mobile */}
					{profileLink && (
						<a 
							href={profileLink} 
							target="_blank" 
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] sm:text-sm font-semibold rounded-lg transition-colors duration-200 border border-white/30 mt-1 sm:mt-2"
						>
							Cricheros
						</a>
					)}
					</div>
					</div>
					
					{/* Stats next to image on desktop only */}
					<div className="hidden lg:flex flex-col justify-center gap-6 lg:gap-8">
						{batting && (
							<div className="flex flex-col gap-2">
								<span className="text-sm sm:text-base font-semibold text-white/70 uppercase tracking-widest">BATSMEN</span>
								<span className="text-2xl sm:text-3xl lg:text-4xl font-black text-white uppercase">{batting}</span>
							</div>
						)}
						{bowling && (
							<div className="flex flex-col gap-2">
								<span className="text-sm sm:text-base font-semibold text-white/70 uppercase tracking-widest">BOWLER</span>
								<span className="text-2xl sm:text-3xl lg:text-4xl font-black text-white uppercase">{bowling}</span>
							</div>
						)}
						
					{/* Cricheros Profile Link - Desktop */}
					{profileLink && (
						<a 
							href={profileLink} 
							target="_blank" 
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors duration-200 border border-white/30 mt-2"
						>
							Cricheros
						</a>
					)}
					</div>
				</div>
				
				{/* Tags */}
				{tags.length > 0 && (
					<div className="flex flex-wrap gap-2 justify-center mt-6">
						{tags.map((t, i) => (
							<Badge key={i} className="bg-white/20 text-white font-semibold text-xs px-3 py-1">
								{t.label}
							</Badge>
						))}
					</div>
				)}
				
			{/* Base Price - Bottom Right Corner */}
			{basePrice !== undefined && (
				<div className="absolute bottom-3 right-3 sm:bottom-6 sm:right-6 text-right">
					<span className="text-[9px] sm:text-xs text-white/60 uppercase tracking-wider block">Base Price</span>
					<span className="text-base sm:text-3xl font-black text-white">₹{basePrice/1000}k</span>
				</div>
			)}
			</div>
		</div>
	)
}
