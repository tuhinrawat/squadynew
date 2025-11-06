"use client"

import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

export interface ActionButtonsProps {
	onMarkSold: () => void | Promise<void>
	onMarkUnsold: () => void | Promise<void>
	onUndoSale?: () => void | Promise<void>
	isDisabled?: boolean
	isMarkingSold?: boolean
	isMarkingUnsold?: boolean
}

export default function ActionButtons({ onMarkSold, onMarkUnsold, onUndoSale, isDisabled, isMarkingSold, isMarkingUnsold }: ActionButtonsProps) {
	return (
		<div className="flex flex-col sm:flex-row gap-3 w-full">
			<Button 
				onClick={onMarkSold} 
				disabled={isDisabled || isMarkingSold || isMarkingUnsold} 
				className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base sm:text-lg rounded-lg h-16 sm:h-20 min-h-[64px] sm:min-h-[80px]"
			>
				{isMarkingSold && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
				{isMarkingSold ? 'Marking Sold...' : 'Mark Sold'}
			</Button>
			
			<Button 
				onClick={onMarkUnsold} 
				disabled={isDisabled || isMarkingSold || isMarkingUnsold} 
				className="flex-1 bg-gray-700 hover:bg-gray-800 text-white font-semibold text-base sm:text-lg rounded-lg h-16 sm:h-20 min-h-[64px] sm:min-h-[80px]"
			>
				{isMarkingUnsold && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
				{isMarkingUnsold ? 'Marking...' : 'Mark Unsold'}
			</Button>
			
			{onUndoSale && (
				<Button 
					onClick={onUndoSale} 
					disabled={isDisabled || isMarkingSold || isMarkingUnsold} 
					className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold text-base sm:text-lg rounded-lg h-16 sm:h-20 min-h-[64px] sm:min-h-[80px]"
				>
					Undo Last Sale
				</Button>
			)}
		</div>
	)
}
