// Auction State Tracking - Dynamic team needs and remaining player pool analysis

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AuctionState {
  soldPlayers: any[]
  availablePlayers: any[]
  auctionStage: 'Early' | 'Mid' | 'Late'
  totalPlayers: number
  soldCount: number
  availableCount: number
  progressPercent: number
  playersBySpeciality: {
    [speciality: string]: {
      sold: number
      available: number
      total: number
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TeamNeedsAnalysis {
  bidderId: string
  teamName: string
  needs: string[]
  urgency: number // 0-10
  reasoning: string
  purchasedPlayers: any[]
  specialities: string[]
  battingTypes: string[]
  bowlingTypes: string[]
  needsBatters: boolean
  needsBowlers: boolean
  needsAllrounders: boolean
  needsKeepers: boolean
}

/**
 * Calculate auction state from players array
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calculateAuctionState(players: any[]): AuctionState {
  const soldPlayers = players.filter(p => p.status === 'SOLD')
  const availablePlayers = players.filter(p => p.status === 'AVAILABLE')
  const totalPlayers = players.length
  const soldCount = soldPlayers.length
  const availableCount = availablePlayers.length
  const progressPercent = totalPlayers > 0 ? (soldCount / totalPlayers) * 100 : 0

  // Determine auction stage
  let auctionStage: 'Early' | 'Mid' | 'Late'
  if (progressPercent < 33) {
    auctionStage = 'Early'
  } else if (progressPercent < 67) {
    auctionStage = 'Mid'
  } else {
    auctionStage = 'Late'
  }

  // Count players by speciality
  const playersBySpeciality: { [key: string]: { sold: number; available: number; total: number } } = {}
  
  players.forEach(player => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = player.data as any
    const speciality = data?.Speciality || data?.speciality || 'Unknown'
    
    if (!playersBySpeciality[speciality]) {
      playersBySpeciality[speciality] = { sold: 0, available: 0, total: 0 }
    }
    
    playersBySpeciality[speciality].total++
    if (player.status === 'SOLD') {
      playersBySpeciality[speciality].sold++
    } else if (player.status === 'AVAILABLE') {
      playersBySpeciality[speciality].available++
    }
  })

  return {
    soldPlayers,
    availablePlayers,
    auctionStage,
    totalPlayers,
    soldCount,
    availableCount,
    progressPercent,
    playersBySpeciality
  }
}

/**
 * Analyze team needs for a specific bidder based on purchased players
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function analyzeTeamNeeds(
  bidderId: string,
  teamName: string,
  purchasedPlayers: any[],
  auctionState: AuctionState
): TeamNeedsAnalysis {
  // Extract specialities, batting types, bowling types from purchased players
  const specialities: string[] = []
  const battingTypes: string[] = []
  const bowlingTypes: string[] = []
  let hasKeeper = false

  purchasedPlayers.forEach(player => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = player.data as any
    const speciality = data?.Speciality || data?.speciality || ''
    const batting = data?.['Batting Type'] || data?.batting || ''
    const bowling = data?.['Bowling Type'] || data?.bowling || ''
    const isKeeper = data?.['Is Keeper'] || data?.['Wicket Keeper'] || data?.isKeeper || 'No'

    if (speciality) specialities.push(speciality)
    if (batting) battingTypes.push(batting)
    if (bowling) bowlingTypes.push(bowling)
    if (isKeeper === 'Yes' || isKeeper === true || String(isKeeper).toLowerCase() === 'yes') {
      hasKeeper = true
    }
  })

  // Determine needs (team size is 12 including bidder, so need 11 players)
  const targetTeamSize = 11
  const currentSize = purchasedPlayers.length
  const remainingSlots = targetTeamSize - currentSize

  const needs: string[] = []
  let urgency = 5 // Default urgency

  // Check for batters (need at least 3-4)
  const batterCount = specialities.filter(s => 
    s.toLowerCase().includes('batter') || s.toLowerCase().includes('batsman')
  ).length
  const needsBatters = batterCount < 3

  // Check for bowlers (need at least 3-4)
  const bowlerCount = specialities.filter(s => 
    s.toLowerCase().includes('bowler')
  ).length
  const needsBowlers = bowlerCount < 3

  // Check for allrounders (need at least 1-2)
  const allrounderCount = specialities.filter(s => 
    s.toLowerCase().includes('allrounder')
  ).length
  const needsAllrounders = allrounderCount < 1

  // Check for keepers (need at least 1)
  const needsKeepers = !hasKeeper

  if (needsBatters) needs.push('Batters')
  if (needsBowlers) needs.push('Bowlers')
  if (needsAllrounders) needs.push('Allrounders')
  if (needsKeepers) needs.push('Wicket Keeper')

  // Calculate urgency based on:
  // 1. Remaining slots (more slots = lower urgency)
  // 2. Available players in needed categories (fewer available = higher urgency)
  // 3. Auction stage (late stage = higher urgency for missing roles)
  
  let urgencyScore = 0
  
  // Factor 1: Remaining slots (0-3 points)
  if (remainingSlots <= 2) urgencyScore += 3
  else if (remainingSlots <= 4) urgencyScore += 2
  else if (remainingSlots <= 6) urgencyScore += 1

  // Factor 2: Available players in needed categories (0-4 points)
  if (needsBatters) {
    const availableBatters = auctionState.playersBySpeciality['Batter']?.available || 
                            auctionState.playersBySpeciality['Batsman']?.available || 0
    if (availableBatters <= 5) urgencyScore += 2
    else if (availableBatters <= 10) urgencyScore += 1
  }
  
  if (needsBowlers) {
    const availableBowlers = auctionState.playersBySpeciality['Bowler']?.available || 0
    if (availableBowlers <= 5) urgencyScore += 2
    else if (availableBowlers <= 10) urgencyScore += 1
  }

  // Factor 3: Auction stage (0-3 points)
  if (auctionState.auctionStage === 'Late') urgencyScore += 3
  else if (auctionState.auctionStage === 'Mid') urgencyScore += 1

  urgency = Math.min(10, Math.max(0, urgencyScore))

  // Build reasoning
  const reasoningParts: string[] = []
  reasoningParts.push(`Team has ${currentSize}/${targetTeamSize} players`)
  if (needs.length > 0) {
    reasoningParts.push(`Needs: ${needs.join(', ')}`)
  } else {
    reasoningParts.push('Team is balanced')
  }
  reasoningParts.push(`Urgency: ${urgency}/10 (based on remaining slots: ${remainingSlots}, available players, and auction stage: ${auctionState.auctionStage})`)

  return {
    bidderId,
    teamName,
    needs: needs.length > 0 ? needs : ['Balanced Team'],
    urgency,
    reasoning: reasoningParts.join('. '),
    purchasedPlayers,
    specialities: [...new Set(specialities)],
    battingTypes: [...new Set(battingTypes)],
    bowlingTypes: [...new Set(bowlingTypes)],
    needsBatters,
    needsBowlers,
    needsAllrounders,
    needsKeepers
  }
}

/**
 * Calculate remaining pool impact for a player
 * Returns 'high', 'medium', or 'low' supply indicator
 */
export function calculateRemainingPoolImpact(
  playerSpeciality: string,
  auctionState: AuctionState
): 'high' | 'medium' | 'low' {
  const specialityKey = playerSpeciality || 'Unknown'
  const poolData = auctionState.playersBySpeciality[specialityKey] || { available: 0, total: 0 }
  const availableCount = poolData.available

  // High supply: 15+ available players of this speciality
  // Medium supply: 5-14 available
  // Low supply: <5 available
  if (availableCount >= 15) return 'high'
  if (availableCount >= 5) return 'medium'
  return 'low'
}

/**
 * Get remaining pool summary for market analysis
 */
export function getRemainingPoolSummary(auctionState: AuctionState): {
  bowlersLeft: number
  battersLeft: number
  allroundersLeft: number
  keepersLeft: number
  totalLeft: number
} {
  const bowlers = auctionState.playersBySpeciality['Bowler']?.available || 0
  const batters = (auctionState.playersBySpeciality['Batter']?.available || 0) + 
                 (auctionState.playersBySpeciality['Batsman']?.available || 0)
  const allrounders = auctionState.playersBySpeciality['Allrounder']?.available || 0
  const keepers = auctionState.playersBySpeciality['Wicket Keeper']?.available || 0

  return {
    bowlersLeft: bowlers,
    battersLeft: batters,
    allroundersLeft: allrounders,
    keepersLeft: keepers,
    totalLeft: auctionState.availableCount
  }
}

