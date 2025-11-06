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
		<div className="relative rounded-xl overflow-hidden w-full max-w-4xl mx-auto font-['Montserrat'] bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
			{/* Decorative curved shapes on left side */}
			<div className="absolute left-0 top-0 bottom-0 w-32 opacity-30">
				<svg viewBox="0 0 100 400" className="w-full h-full">
					<path d="M 0 0 Q 50 100 0 200 Q 50 300 0 400 L 0 0 Z" fill="#555" opacity="0.5"/>
					<path d="M 20 0 Q 70 100 20 200 Q 70 300 20 400 L 20 0 Z" fill="#666" opacity="0.3"/>
				</svg>
			</div>
			
			{/* Content */}
			<div className="relative z-10 p-6 sm:p-8 lg:p-10">
				{/* Player Name at Top */}
				<div className="mb-6">
					<h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white uppercase tracking-tight leading-tight">
						{name}
					</h2>
					<div className="w-16 sm:w-20 h-1 bg-white mt-3 sm:mt-4"></div>
				</div>
				
				{/* Speciality Section */}
				{speciality && (
					<div className="mb-8">
						<div className="flex items-center gap-3">
							<span className="text-xs sm:text-sm font-semibold text-white uppercase tracking-widest">SPECIALITY</span>
							<span className="text-lg sm:text-xl lg:text-2xl font-black text-white uppercase">{speciality}</span>
						</div>
					</div>
				)}
				
				{/* Center: Player Image */}
				<div className="flex flex-col items-center mb-8">
					<div className="relative w-48 h-48 sm:w-56 sm:h-56 lg:w-64 lg:h-64 mb-3">
						{imageUrl ? (
							<img 
								src={imageUrl} 
								alt={name} 
								className="w-full h-full object-cover rounded-full border-4 border-white/20"
							/>
						) : (
							<div className="w-full h-full rounded-full bg-gradient-to-br from-blue-300 via-sky-200 to-green-300 flex items-center justify-center border-4 border-white/20">
								<span className="text-6xl sm:text-7xl font-black text-white/80">{name.charAt(0).toUpperCase()}</span>
							</div>
						)}
					</div>
					
					{/* Cricheros Profile Link */}
					{profileLink && (
						<a 
							href={profileLink} 
							target="_blank" 
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors duration-200 border border-white/30"
						>
							<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
							</svg>
							View Profile
						</a>
					)}
				</div>
				
				{/* Bottom Stats - Two Columns */}
				<div className="grid grid-cols-2 gap-x-1 sm:gap-x-12 gap-y-2 sm:gap-y-3">
					{batting && (
						<div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
							<span className="text-[7px] sm:text-sm font-semibold text-white uppercase tracking-tight sm:tracking-widest whitespace-nowrap">BATSMEN</span>
							<span className="text-[9px] sm:text-base lg:text-lg font-black text-white uppercase leading-tight">{batting}</span>
						</div>
					)}
					{bowling && (
						<div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
							<span className="text-[7px] sm:text-sm font-semibold text-white uppercase tracking-tight sm:tracking-widest whitespace-nowrap">BOWLER</span>
							<span className="text-[9px] sm:text-base lg:text-lg font-black text-white uppercase leading-tight">{bowling}</span>
						</div>
					)}
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
					<div className="absolute bottom-6 right-6 text-right">
						<span className="text-xs text-white/60 uppercase tracking-wider block">Base Price</span>
						<span className="text-2xl sm:text-3xl font-black text-white">₹{basePrice/1000}k</span>
					</div>
				)}
			</div>
		</div>
	)
}
