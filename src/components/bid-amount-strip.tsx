"use client"

import { Trophy } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export interface BidAmountStripProps {
	amount: number | null
	bidderName?: string | null
	teamName?: string | null
	nextMin?: number
	auctionId?: string
}

// Current bid / leading bidder now show as a banner at the top of PlayerCard
// itself, so they're visible without scrolling. This strip's only remaining
// job is the "All Players & Teams" link.
export default function BidAmountStrip({ auctionId }: BidAmountStripProps) {
	if (!auctionId) return null

	return (
		<div className="flex justify-center py-3 sm:py-4">
			<Link href={`/auction/${auctionId}/teams`} target="_blank" rel="noopener noreferrer">
				<Button className="bg-teal-600 hover:bg-teal-700 text-white h-10 px-4" size="sm">
					<Trophy className="h-4 w-4 mr-1.5" />
					All Players &amp; Teams
				</Button>
			</Link>
		</div>
	)
}
