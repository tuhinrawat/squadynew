"use client"

import { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

export interface PlayerCardProps {
	name: string
	imageUrl?: string | null
	tags?: Array<{ label: string; color?: 'purple' | 'blue' | 'green' }>
	fields?: Array<{ label: string; value: ReactNode }>
	isLoading?: boolean
}

export default function PlayerCard({ name, imageUrl, tags = [], fields = [], isLoading }: PlayerCardProps) {
	return (
		<div className="bg-white dark:bg-gray-800 rounded-xl shadow px-4 sm:px-6 py-4">
			<div className="flex flex-col items-center gap-3">
				<div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden flex items-center justify-center shadow-inner">
					{imageUrl ? (
						<img src={imageUrl} alt={name} className="w-full h-full object-cover" />
					) : (
						<span className="text-3xl sm:text-4xl font-bold text-gray-500 dark:text-gray-300">{name.charAt(0).toUpperCase()}</span>
					)}
				</div>
				<div className="flex items-center gap-2 flex-wrap justify-center">
					<h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{name}</h2>
					{tags.map((t, i) => (
						<Badge key={i} className={t.color === 'purple' ? 'bg-purple-100 text-purple-700' : t.color === 'green' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}>
							{t.label}
						</Badge>
					))}
				</div>
			</div>
			{fields.length > 0 && (
				<div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
					{fields.map((f, i) => (
						<div key={i} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 py-1">
							<span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{f.label}</span>
							<span className="text-sm sm:text-base font-medium text-gray-900 dark:text-gray-100">{f.value}</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
