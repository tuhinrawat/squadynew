// Player Stats Scoring Logic for APL 2026 Auction
// Calculates overall rating and predicted prices based on player statistics

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Player {
  name: string
  speciality: string
  battingType?: string
  bowlingType?: string
  isKeeper?: string | boolean
  availability?: string
  lastPlayed?: string
  runs?: number
  avg?: number
  eco?: number
  wickets?: number
  catches?: number
  matches?: number
  strength?: string
  cricheroes?: string
  status?: 'available' | 'sold' | 'unsold'
  [key: string]: any // For additional custom fields
}

export interface ScoreResult {
  overallRating: number
  predictedPrice: number
  minPrice: number
  avgPrice: number
  maxPrice: number
  reasoning: string
  breakdown?: {
    battingScore: number
    bowlingScore: number
    allrounderBonus: number
    keeperBonus: number
    experienceScore: number
    formScore: number
  }
}

/**
 * Calculate player score based on stats (fixed 100k-purse formula)
 * This implements the exact scoring logic from the requirements
 */
export function calculatePlayerScore(player: Player | any): ScoreResult {
  // Extract player data (handle both Player interface and raw data objects)
  const name = player.name || player.Name || player.data?.Name || 'Unknown'
  const speciality = player.speciality || player.Speciality || player.data?.Speciality || ''
  const isKeeper = player.isKeeper || player.data?.['Is Keeper'] || player.data?.['Wicket Keeper'] || 'No'
  const availability = player.availability || player.Availability || player.data?.Availability || ''
  const lastPlayed = player.lastPlayed || player.data?.['Last Played'] || player.data?.['Last Played Date'] || ''
  
  // Extract stats (try multiple possible column names)
  const runs = player.runs || player.data?.Runs || player.data?.runs || 0
  const avg = player.avg || player.data?.Average || player.data?.Avg || player.data?.average || 0
  const eco = player.eco || player.data?.Economy || player.data?.Eco || player.data?.economy || 8
  const wickets = player.wickets || player.data?.Wickets || player.data?.wickets || 0
  const catches = player.catches || player.data?.Catches || player.data?.catches || 0
  const matches = player.matches || player.data?.Matches || player.data?.matches || 0

  // Calculate batting score (0-100)
  // Formula: If runs > 50, score = (runs/4000) * 70 + avg * 1.1, capped at 100
  const battingScore = runs > 50 
    ? Math.min(100, (runs / 4000) * 70 + (avg || 0) * 1.1)
    : 0

  // Calculate bowling score (0-100)
  // Formula: If wickets > 10, score = (wickets/180) * 80 + max(0, 20 - (eco - 7.5) * 3)
  const bowlingScore = wickets > 10
    ? Math.min(100, (wickets / 180) * 80 + Math.max(0, 20 - ((eco || 8) - 7.5) * 3))
    : 0

  // Allrounder bonus
  const allrounderBonus = speciality.toLowerCase().includes('allrounder') ? 25 : 0

  // Keeper bonus
  const keeperBonus = (isKeeper === 'Yes' || isKeeper === true || String(isKeeper).toLowerCase() === 'yes') ? 15 : 0

  // Experience score (0-100)
  // Formula: (matches/200) * 100, capped at 100, minimum 30 if no matches
  const experienceScore = matches 
    ? Math.min(100, (matches / 200) * 100) 
    : 30

  // Form score based on lastPlayed date/keywords
  const formScore = (() => {
    if (!lastPlayed) return 50
    const keywords = String(lastPlayed).toLowerCase()
    if (keywords.includes('today') || keywords.includes('regular') || keywords.includes('2025') || keywords.includes('2026')) return 100
    if (keywords.includes('month')) return 85
    if (keywords.includes('year')) return 70
    return 40
  })()

  // Calculate overall rating (0-100)
  // Formula: battingScore * 0.25 + bowlingScore * 0.25 + allrounderBonus + keeperBonus + experienceScore * 0.15 + formScore * 0.10
  const overallRating = Math.round(
    battingScore * 0.25 + 
    bowlingScore * 0.25 + 
    allrounderBonus + 
    keeperBonus + 
    experienceScore * 0.15 + 
    formScore * 0.10
  )

  // Calculate predicted price
  // Formula: 1000 + (overallRating/100) * 24000 + allrounderBonus(6000) + keeperBonus(4000) + availabilityBonus(2000)
  const basePrice = 1000
  const ratingMultiplier = (overallRating / 100) * 24000
  const allrounderPriceBonus = speciality.toLowerCase().includes('allrounder') ? 6000 : 0
  const keeperPriceBonus = (isKeeper === 'Yes' || isKeeper === true || String(isKeeper).toLowerCase() === 'yes') ? 4000 : 0
  const availabilityBonus = availability.includes('Both') || availability.includes('both') ? 2000 : 0
  
  const predictedPrice = Math.round(
    basePrice + 
    ratingMultiplier + 
    allrounderPriceBonus + 
    keeperPriceBonus + 
    availabilityBonus
  )

  // Calculate price range
  const minPrice = Math.max(1000, Math.round(predictedPrice * 0.65))
  const avgPrice = predictedPrice
  const maxPrice = Math.min(32000, Math.round(predictedPrice * 1.45))

  // Build reasoning
  const reasoningParts: string[] = []
  reasoningParts.push(`${name}: Overall rating ${overallRating}/100`)
  if (battingScore > 0) reasoningParts.push(`Batting: ${Math.round(battingScore)}/100`)
  if (bowlingScore > 0) reasoningParts.push(`Bowling: ${Math.round(bowlingScore)}/100`)
  if (allrounderBonus > 0) reasoningParts.push(`Allrounder bonus: +${allrounderBonus}`)
  if (keeperBonus > 0) reasoningParts.push(`Keeper bonus: +${keeperBonus}`)
  reasoningParts.push(`Experience: ${Math.round(experienceScore)}/100, Form: ${Math.round(formScore)}/100`)
  reasoningParts.push(`Predicted price: ₹${predictedPrice.toLocaleString('en-IN')} (range: ₹${minPrice.toLocaleString('en-IN')} - ₹${maxPrice.toLocaleString('en-IN')})`)
  reasoningParts.push('Adjusted for auction rules (100k purse, 1k base, increments).')

  return {
    overallRating: Math.max(0, Math.min(100, overallRating)),
    predictedPrice: roundToNearestThousand(predictedPrice),
    minPrice: roundToNearestThousand(minPrice),
    avgPrice: roundToNearestThousand(avgPrice),
    maxPrice: roundToNearestThousand(maxPrice),
    reasoning: reasoningParts.join('. '),
    breakdown: {
      battingScore: Math.round(battingScore),
      bowlingScore: Math.round(bowlingScore),
      allrounderBonus,
      keeperBonus,
      experienceScore: Math.round(experienceScore),
      formScore: Math.round(formScore)
    }
  }
}

/**
 * Helper function to round to nearest 1000
 */
function roundToNearestThousand(amount: number): number {
  if (amount <= 0) return 1000
  return Math.max(1000, Math.round(amount / 1000) * 1000)
}

/**
 * Calculate score for a player from Prisma Player model
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calculatePlayerScoreFromData(playerData: any): ScoreResult {
  // Extract all relevant fields from player.data
  const data = playerData.data || playerData
  
  const player: Player = {
    name: data.Name || data.name || 'Unknown',
    speciality: data.Speciality || data.speciality || '',
    battingType: data['Batting Type'] || data.battingType || data.batting || '',
    bowlingType: data['Bowling Type'] || data.bowlingType || data.bowling || '',
    isKeeper: data['Is Keeper'] || data['Wicket Keeper'] || data.isKeeper || 'No',
    availability: data.Availability || data.availability || '',
    lastPlayed: data['Last Played'] || data['Last Played Date'] || data.lastPlayed || '',
    runs: parseFloat(data.Runs || data.runs || 0),
    avg: parseFloat(data.Average || data.Avg || data.average || 0),
    eco: parseFloat(data.Economy || data.Eco || data.economy || 8),
    wickets: parseFloat(data.Wickets || data.wickets || 0),
    catches: parseFloat(data.Catches || data.catches || 0),
    matches: parseFloat(data.Matches || data.matches || 0),
    strength: data.Strength || data.strength || '',
    cricheroes: data.Cricheroes || data.cricheroes || ''
  }

  return calculatePlayerScore(player)
}

/**
 * Derive speciality from player stats (batting score, bowling score)
 * Returns: 'Batter', 'Bowler', 'Allrounder', or 'Unknown'
 */
export function deriveSpecialityFromStats(scoreResult: ScoreResult): string {
  const battingScore = scoreResult.breakdown?.battingScore || 0
  const bowlingScore = scoreResult.breakdown?.bowlingScore || 0
  
  // If both batting and bowling scores are significant, it's an allrounder
  if (battingScore >= 40 && bowlingScore >= 40) {
    return 'Allrounder'
  }
  
  // If batting score is significantly higher, it's a batter
  if (battingScore > bowlingScore + 20) {
    return 'Batter'
  }
  
  // If bowling score is significantly higher, it's a bowler
  if (bowlingScore > battingScore + 20) {
    return 'Bowler'
  }
  
  // If both are moderate (20-40), consider allrounder
  if (battingScore >= 20 && bowlingScore >= 20) {
    return 'Allrounder'
  }
  
  // If only one is significant, use that
  if (battingScore >= 30) {
    return 'Batter'
  }
  
  if (bowlingScore >= 30) {
    return 'Bowler'
  }
  
  // Default to unknown if scores are too low
  return 'Unknown'
}

/**
 * Get predicted stats summary string
 */
export function getPredictedStatsSummary(scoreResult: ScoreResult): string {
  const battingScore = scoreResult.breakdown?.battingScore || 0
  const bowlingScore = scoreResult.breakdown?.bowlingScore || 0
  const experienceScore = scoreResult.breakdown?.experienceScore || 0
  const formScore = scoreResult.breakdown?.formScore || 0
  
  const parts: string[] = []
  
  if (battingScore > 0) {
    parts.push(`Bat: ${Math.round(battingScore)}`)
  }
  if (bowlingScore > 0) {
    parts.push(`Bowl: ${Math.round(bowlingScore)}`)
  }
  if (experienceScore > 0) {
    parts.push(`Exp: ${Math.round(experienceScore)}`)
  }
  if (formScore > 0) {
    parts.push(`Form: ${Math.round(formScore)}`)
  }
  
  return parts.join(' • ') || 'N/A'
}

