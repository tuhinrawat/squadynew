"use client"

import { Button } from '@/components/ui/button'

export interface ActionButtonsProps {
	onMarkSold: () => void | Promise<void>
	onMarkUnsold: () => void | Promise<void>
	onUndoSale?: () => void | Promise<void>
	isDisabled?: boolean
}

export default function ActionButtons({ onMarkSold, onMarkUnsold, onUndoSale, isDisabled }: ActionButtonsProps) {
	return (
		<div className="space-y-2">
			<div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-2">
				<Button onClick={onMarkSold} disabled={isDisabled} className="w-full bg-emerald-600 hover:bg-emerald-700">
					Mark Sold
				</Button>
			</div>
			<div className="flex gap-2">
				<Button variant="outline" onClick={onMarkUnsold} disabled={isDisabled} className="flex-1">Mark Unsold</Button>
				{onUndoSale && (
					<Button variant="destructive" onClick={onUndoSale} disabled={isDisabled} className="flex-1">Undo Last Sale</Button>
				)}
			</div>
		</div>
	)
}
