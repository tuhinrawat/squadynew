"use client"

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { BatIcon, BallIcon, ScaleBar, StatTile } from '@/components/cricket-stat-ui'
import {
	BattingStats,
	BowlingStats,
	BATTING_AVERAGE_RANGE,
	BATTING_STRIKE_RATE_RANGE,
	BOWLING_ECONOMY_RANGE,
	BOWLING_AVERAGE_RANGE,
	scalePercent,
} from '@/lib/cricket-stats'

export interface PlayerStatsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	discipline: 'batting' | 'bowling'
	battingStats?: BattingStats | null
	bowlingStats?: BowlingStats | null
	// The style descriptor already uploaded for this player (e.g. "Right-hand
	// bat", "Right Arm Medium Pace") - shown as a subtitle when available,
	// omitted otherwise rather than guessed.
	styleText?: string
}

// The "View More" popup for a player's career stats - a recap of the same
// total + scale bars shown on the card (for visual continuity), then
// everything else grouped into scannable tiles instead of one flat list.
// Shared by the live-auction PlayerCard and the Know Your Players grid
// cards, which otherwise would have needed to duplicate ~150 lines of this
// twice more.
export function PlayerStatsDialog({ open, onOpenChange, discipline, battingStats, bowlingStats, styleText }: PlayerStatsDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="bg-[#0d1015] border-white/10 text-white max-w-md p-5 sm:p-6 font-['Montserrat']">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-2.5">
						{discipline === 'batting' ? <BatIcon size={18} /> : <BallIcon size={18} />}
						<div>
							<DialogTitle className="text-white text-sm font-extrabold uppercase tracking-wide">
								{discipline === 'batting' ? 'Batting' : 'Bowling'}
							</DialogTitle>
							{styleText && (
								<DialogDescription className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide mt-0.5">{styleText}</DialogDescription>
							)}
						</div>
					</div>
					<button type="button" onClick={() => onOpenChange(false)} className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0">
						<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>

				{discipline === 'batting' && battingStats && (
					<>
						<div className="pt-4 mt-4 border-t border-white/[0.08] space-y-3">
							{battingStats.runs !== undefined && (
								<div className="flex items-baseline justify-between mb-1">
									<span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Career Runs</span>
									<span className="text-xl font-black text-white tabular-nums">{battingStats.runs}</span>
								</div>
							)}
							{battingStats.average !== undefined && (
								<ScaleBar label="Average" value={scalePercent(battingStats.average, BATTING_AVERAGE_RANGE)} formatted={battingStats.average.toFixed(2)} />
							)}
							{battingStats.strikeRate !== undefined && (
								<ScaleBar label="Strike Rate" value={scalePercent(battingStats.strikeRate, BATTING_STRIKE_RATE_RANGE)} formatted={battingStats.strikeRate.toFixed(2)} />
							)}
						</div>

						<div className="pt-4 mt-4 border-t border-white/[0.08]">
							<div className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 mb-2.5">Innings &amp; Milestones</div>
							<div className="grid grid-cols-3 gap-2 mb-4">
								{battingStats.matches !== undefined && <StatTile label="Matches" value={battingStats.matches} />}
								{battingStats.innings !== undefined && <StatTile label="Innings" value={battingStats.innings} />}
								{battingStats.notOut !== undefined && <StatTile label="Not Out" value={battingStats.notOut} />}
								{battingStats.thirties !== undefined && <StatTile label="30s" value={battingStats.thirties} />}
								{battingStats.fifties !== undefined && <StatTile label="50s" value={battingStats.fifties} />}
								{battingStats.hundreds !== undefined && <StatTile label="100s" value={battingStats.hundreds} />}
							</div>

							<div className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 mb-2.5">Boundaries &amp; Record</div>
							<div className="grid grid-cols-3 gap-2">
								{battingStats.highest !== undefined && <StatTile label="Highest" value={battingStats.highest} />}
								{battingStats.fours !== undefined && <StatTile label="4s" value={battingStats.fours} />}
								{battingStats.sixes !== undefined && <StatTile label="6s" value={battingStats.sixes} />}
								{battingStats.ducks !== undefined && <StatTile label="Ducks" value={battingStats.ducks} />}
								{battingStats.matchesWon !== undefined && <StatTile label="Matches Won" value={battingStats.matchesWon} />}
								{battingStats.matchesLost !== undefined && <StatTile label="Matches Lost" value={battingStats.matchesLost} />}
							</div>
						</div>
					</>
				)}

				{discipline === 'bowling' && bowlingStats && (
					<>
						<div className="pt-4 mt-4 border-t border-white/[0.08] space-y-3">
							{bowlingStats.wickets !== undefined && (
								<div className="flex items-baseline justify-between mb-1">
									<span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Career Wickets</span>
									<span className="text-xl font-black text-white tabular-nums">{bowlingStats.wickets}</span>
								</div>
							)}
							{bowlingStats.economy !== undefined && (
								<ScaleBar label="Economy" value={scalePercent(bowlingStats.economy, BOWLING_ECONOMY_RANGE, true)} formatted={bowlingStats.economy.toFixed(2)} />
							)}
							{bowlingStats.average !== undefined && (
								<ScaleBar label="Average" value={scalePercent(bowlingStats.average, BOWLING_AVERAGE_RANGE, true)} formatted={bowlingStats.average.toFixed(2)} />
							)}
						</div>

						<div className="pt-4 mt-4 border-t border-white/[0.08]">
							<div className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 mb-2.5">Overs &amp; Discipline</div>
							<div className="grid grid-cols-3 gap-2 mb-4">
								{bowlingStats.matches !== undefined && <StatTile label="Matches" value={bowlingStats.matches} />}
								{bowlingStats.innings !== undefined && <StatTile label="Innings" value={bowlingStats.innings} />}
								{bowlingStats.overs !== undefined && <StatTile label="Overs" value={bowlingStats.overs} />}
								{bowlingStats.maidens !== undefined && <StatTile label="Maidens" value={bowlingStats.maidens} />}
								{bowlingStats.runsConceded !== undefined && <StatTile label="Runs" value={bowlingStats.runsConceded} />}
								{bowlingStats.dotBalls !== undefined && <StatTile label="Dot Balls" value={bowlingStats.dotBalls} />}
							</div>

							<div className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 mb-2.5">Wickets &amp; Extras</div>
							<div className="grid grid-cols-3 gap-2">
								{bowlingStats.best !== undefined && <StatTile label="Best" value={bowlingStats.best} />}
								{bowlingStats.threeWickets !== undefined && <StatTile label="3 Wkts" value={bowlingStats.threeWickets} />}
								{bowlingStats.fiveWickets !== undefined && <StatTile label="5 Wkts" value={bowlingStats.fiveWickets} />}
								{bowlingStats.wides !== undefined && <StatTile label="Wides" value={bowlingStats.wides} />}
								{bowlingStats.noBalls !== undefined && <StatTile label="No Balls" value={bowlingStats.noBalls} />}
								{bowlingStats.fours !== undefined && <StatTile label="4s" value={bowlingStats.fours} />}
								{bowlingStats.sixes !== undefined && <StatTile label="6s" value={bowlingStats.sixes} />}
							</div>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
