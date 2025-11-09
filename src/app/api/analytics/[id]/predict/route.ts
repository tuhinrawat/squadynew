import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScoreFromData, ScoreResult, deriveSpecialityFromStats, getPredictedStatsSummary } from '@/lib/playerStats'
import { calculateAuctionState, analyzeTeamNeeds, calculateRemainingPoolImpact, getRemainingPoolSummary, AuctionState } from '@/lib/auctionState'

// Lazy load OpenAI to avoid build-time errors
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require('openai')
    if (!OpenAI) {
      console.error('OpenAI module not found')
      return null
    }
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  } catch (error) {
    console.error('Error loading OpenAI module:', error)
    return null
  }
}

// Helper function to round bid amounts to nearest 1000 (minimum bid increment)
function roundToNearestThousand(amount: number): number {
  if (amount <= 0) return 1000 // Minimum bid is 1000
  return Math.max(1000, Math.round(amount / 1000) * 1000)
}

type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH'

interface SuggestedPriceOptions {
  statsPredictedPrice?: number | null
  statsMinPrice?: number | null
  statsMaxPrice?: number | null
  estimatedFinalPrice?: number | null
  mustSpendPerSlot?: number | null
  basePrice: number
  urgency: UrgencyLevel
}

function calculateSuggestedBuyPrice({
  statsPredictedPrice,
  statsMinPrice,
  statsMaxPrice,
  estimatedFinalPrice,
  mustSpendPerSlot,
  basePrice,
  urgency
}: SuggestedPriceOptions): number | undefined {
  const normalizedStatsPrice = statsPredictedPrice && statsPredictedPrice > 0
    ? statsPredictedPrice
    : undefined

  const fallbackMarketPrice = estimatedFinalPrice && estimatedFinalPrice > 0
    ? estimatedFinalPrice
    : normalizedStatsPrice

  if (!normalizedStatsPrice && !fallbackMarketPrice && !mustSpendPerSlot) {
    // Not enough data to calculate a meaningful suggested price
    return undefined
  }

  // Base price derived from available data (stats > estimated market > must spend > base * 4)
  const baseMarketPrice =
    normalizedStatsPrice ??
    fallbackMarketPrice ??
    (mustSpendPerSlot && mustSpendPerSlot > 0 ? mustSpendPerSlot : basePrice * 4)

  // Suggested buy price aims for value (default 75% of base market price)
  let suggested = baseMarketPrice * 0.75

  // If we only have estimated market price (no stats), take slightly more conservative target
  if (!normalizedStatsPrice && fallbackMarketPrice) {
    suggested = fallbackMarketPrice * 0.7
  }

  // Factor in must-spend requirements (never go lower than 90% of must spend per slot)
  if (mustSpendPerSlot && mustSpendPerSlot > 0) {
    suggested = Math.max(suggested, mustSpendPerSlot * 0.9)
  }

  // Urgency adjustments
  const urgencyMultiplier =
    urgency === 'HIGH' ? 1.2 :
    urgency === 'MEDIUM' ? 1.05 :
    1

  suggested *= urgencyMultiplier

  // Clamp within stats range if available
  if (statsMinPrice && statsMinPrice > 0) {
    suggested = Math.max(suggested, statsMinPrice)
  }
  if (statsMaxPrice && statsMaxPrice > 0) {
    suggested = Math.min(suggested, statsMaxPrice * 0.9)
  }

  // Ensure suggested price is at least base price + one increment (value buyers shouldn't go below base)
  const minimumReasonable = Math.max(basePrice + 1000, basePrice * 1.5)
  suggested = Math.max(suggested, minimumReasonable)

  return roundToNearestThousand(suggested)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let body
    try {
      body = await request.json()
    } catch (jsonError) {
      console.error('Error parsing request body:', jsonError)
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    
    const { playerId, tusharBidderId, customColumns, useOpenAI = true } = body || {}

    if (!playerId || !tusharBidderId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }
    
    // If useOpenAI is false, skip OpenAI and use fallback only
    const shouldUseOpenAI = useOpenAI !== false && process.env.OPENAI_API_KEY

    // Fetch auction data
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true,
        bidders: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const currentPlayer = auction.players.find(p => p.id === playerId)
    if (!currentPlayer) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const tusharBidder = auction.bidders.find(b => b.id === tusharBidderId)
    if (!tusharBidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Parse bid history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bidHistory = bidHistoryData.filter((bid: any) => bid.playerId === playerId)
      }
    }

    // Get player data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerData = currentPlayer.data as any
    
    // Calculate player score using stats-based scoring
    const playerScore: ScoreResult = calculatePlayerScoreFromData(currentPlayer)
    
    // Calculate auction state (sold vs available, progress, etc.)
    const auctionState: AuctionState = calculateAuctionState(auction.players)
    
    // Get remaining pool summary
    const poolSummary = getRemainingPoolSummary(auctionState)
    
    // Calculate remaining pool impact for current player
    const playerSpeciality = playerData?.Speciality || playerData?.speciality || ''
    const poolImpact = calculateRemainingPoolImpact(playerSpeciality, auctionState)
    
    // Extract custom columns data if provided
    // Also automatically include stats columns even if not in customColumns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customColumnsData: Record<string, any> = {}
    
    // Always include stats columns (they're critical for analysis)
    const statsColumns = ['Matches', 'Runs', 'Average', 'Avg', 'Economy', 'Eco', 'Wickets', 'Catches', 'Strength']
    statsColumns.forEach(col => {
      const value = playerData?.[col] || playerData?.[col.toLowerCase()] || playerData?.[col.toUpperCase()]
      if (value !== undefined && value !== null && value !== '') {
        customColumnsData[col] = value
      }
    })
    
    // Also include any other custom columns provided
    if (customColumns && Array.isArray(customColumns)) {
      customColumns.forEach((col: string) => {
        if (col && typeof col === 'string' && col !== 'name' && col !== 'status' && 
            col !== 'speciality' && col !== 'batting' && col !== 'bowling' && 
            col !== 'soldPrice' && col !== 'soldTo' && !statsColumns.includes(col)) {
          customColumnsData[col] = playerData?.[col]
        }
      })
    }

    // Get upcoming players (not sold, not retired, not current player)
    const upcomingPlayers = auction.players.filter(p => 
      p.id !== playerId && 
      p.status === 'AVAILABLE'
    )

    // Analyze upcoming players to identify brilliant ones
    // This considers: icon status, stats-based scoring, custom analytics columns (ratings, stats), base price
    const upcomingPlayersAnalysis = upcomingPlayers.map(p => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = p.data as any
      const name = data?.Name || data?.name || 'Unknown'
      
      // Calculate stats-based score for upcoming player (CRITICAL for identifying high-value players)
      const upcomingPlayerScore = calculatePlayerScoreFromData(p)
      
      // Calculate a "brilliance score" based on multiple factors
      let brillianceScore = 0
      const factors: string[] = []
      
      // Factor 1: Stats-based Overall Rating (HIGHEST WEIGHT - most important)
      if (upcomingPlayerScore.overallRating >= 70) {
        brillianceScore += 40
        factors.push(`Excellent Stats (Rating: ${upcomingPlayerScore.overallRating}/100)`)
      } else if (upcomingPlayerScore.overallRating >= 60) {
        brillianceScore += 30
        factors.push(`Strong Stats (Rating: ${upcomingPlayerScore.overallRating}/100)`)
      } else if (upcomingPlayerScore.overallRating >= 50) {
        brillianceScore += 20
        factors.push(`Good Stats (Rating: ${upcomingPlayerScore.overallRating}/100)`)
      }
      
      // Factor 2: Stats-based Predicted Price (high predicted price = valuable player)
      if (upcomingPlayerScore.predictedPrice >= 20000) {
        brillianceScore += 35
        factors.push(`High Predicted Price (₹${(upcomingPlayerScore.predictedPrice / 1000).toFixed(0)}k)`)
      } else if (upcomingPlayerScore.predictedPrice >= 15000) {
        brillianceScore += 25
        factors.push(`Moderate-High Predicted Price (₹${(upcomingPlayerScore.predictedPrice / 1000).toFixed(0)}k)`)
      } else if (upcomingPlayerScore.predictedPrice >= 10000) {
        brillianceScore += 15
        factors.push(`Moderate Predicted Price (₹${(upcomingPlayerScore.predictedPrice / 1000).toFixed(0)}k)`)
      }
      
      // Factor 3: Icon status (high weight)
      if (p.isIcon) {
        brillianceScore += 30
        factors.push('Icon Player')
      }
      
      // Factor 4: Base price (higher base price = more valuable)
      const basePrice = data?.['Base Price'] || data?.['base price'] || 1000
      if (basePrice > 50000) {
        brillianceScore += 25
        factors.push('Very High Base Price')
      } else if (basePrice > 25000) {
        brillianceScore += 15
        factors.push('High Base Price')
      } else if (basePrice > 10000) {
        brillianceScore += 10
        factors.push('Moderate Base Price')
      }
      
      // Factor 5: Strong batting/bowling scores from stats
      if (upcomingPlayerScore.breakdown) {
        if (upcomingPlayerScore.breakdown.battingScore >= 60) {
          brillianceScore += 15
          factors.push(`Strong Batting (${upcomingPlayerScore.breakdown.battingScore}/100)`)
        }
        if (upcomingPlayerScore.breakdown.bowlingScore >= 60) {
          brillianceScore += 15
          factors.push(`Strong Bowling (${upcomingPlayerScore.breakdown.bowlingScore}/100)`)
        }
        if (upcomingPlayerScore.breakdown.experienceScore >= 70) {
          brillianceScore += 10
          factors.push(`Experienced (${upcomingPlayerScore.breakdown.experienceScore}/100)`)
        }
      }
      
      // Factor 6: Custom analytics columns (ratings, performance metrics)
      // Look for numeric fields that might indicate quality
      if (customColumns && Array.isArray(customColumns)) {
        customColumns.forEach((col: string) => {
          const value = data?.[col]
          if (typeof value === 'number') {
            // If it's a rating (0-100 scale), add to score
            if (value >= 80) {
              brillianceScore += 20
              factors.push(`High ${col} (${value})`)
            } else if (value >= 60) {
              brillianceScore += 10
              factors.push(`Good ${col} (${value})`)
            }
          } else if (typeof value === 'string') {
            // Check for high-value keywords
            const lowerValue = value.toLowerCase()
            if (lowerValue.includes('excellent') || lowerValue.includes('outstanding') || 
                lowerValue.includes('elite') || lowerValue.includes('top')) {
              brillianceScore += 15
              factors.push(`Excellent ${col}`)
            }
          }
        })
      }
      
      // Factor 7: Derived Speciality from stats (allrounders often more valuable)
      const derivedSpeciality = deriveSpecialityFromStats(upcomingPlayerScore)
      if (derivedSpeciality === 'Allrounder') {
        brillianceScore += 10
        factors.push('Allrounder (Stats-Based)')
      }
      
      return {
        id: p.id,
        name,
        data,
        isIcon: p.isIcon,
        basePrice,
        brillianceScore,
        factors,
        speciality: derivedSpeciality, // Use derived speciality from stats
        predictedSpeciality: derivedSpeciality, // Add predicted speciality column
        predictedStats: getPredictedStatsSummary(upcomingPlayerScore), // Add predicted stats column
        batting: data?.['Batting Type'] || 'N/A',
        bowling: data?.['Bowling Type'] || 'N/A',
        statsScore: upcomingPlayerScore, // Include full stats-based score
        overallRating: upcomingPlayerScore.overallRating,
        predictedPrice: upcomingPlayerScore.predictedPrice
      }
    }).sort((a, b) => b.brillianceScore - a.brillianceScore) // Sort by brilliance score

    // Identify "brilliant" players (top 20% or score > 50)
    const brilliantThreshold = Math.max(50, upcomingPlayersAnalysis.length > 0 
      ? upcomingPlayersAnalysis[Math.floor(upcomingPlayersAnalysis.length * 0.2)]?.brillianceScore || 50
      : 50)
    const brilliantUpcomingPlayers = upcomingPlayersAnalysis.filter(p => p.brillianceScore >= brilliantThreshold)

    // Get auction rules
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules = auction.rules as any
    const minBidIncrement = rules?.minBidIncrement || 1000
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const maxBidIncrement = rules?.maxBidIncrement
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const countdownSeconds = rules?.countdownSeconds || 30
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const iconPlayerCount = rules?.iconPlayerCount || 10
    const totalPurse = rules?.totalPurse || 100000
    
    // Calculate auction stage and competition level
    const totalPlayers = auction.players.length
    const soldPlayers = auction.players.filter(p => p.status === 'SOLD').length
    const auctionProgress = totalPlayers > 0 ? (soldPlayers / totalPlayers) * 100 : 0
    const auctionStage = auctionProgress < 33 ? 'Early' : auctionProgress < 67 ? 'Mid' : 'Late'
    const competitionLevel = bidHistory.length > 2 ? 'high' : bidHistory.length > 0 ? 'medium' : 'low'
    
    // Get bidders choice pool (if available in auction data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const biddersChoicePool = (auction as any).biddersChoicePool || null
    
    // Prepare comprehensive context for AI
    const biddersContext = auction.bidders.map(bidder => {
      const purchased = auction.players.filter(p => p.status === 'SOLD' && p.soldTo === bidder.id)
      const totalSpent = purchased.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
      const avgSpentPerPlayer = purchased.length > 0 ? totalSpent / purchased.length : 0
      
      return {
        id: bidder.id,
        name: bidder.user?.name || bidder.username,
        teamName: bidder.teamName,
        remainingPurse: bidder.remainingPurse,
        initialPurse: bidder.purseAmount || bidder.remainingPurse,
        spent: totalSpent,
        playersPurchased: purchased.length,
        avgSpentPerPlayer: avgSpentPerPlayer,
        purseUtilization: ((bidder.purseAmount || bidder.remainingPurse) - bidder.remainingPurse) / (bidder.purseAmount || bidder.remainingPurse) * 100,
        canAfford: bidder.remainingPurse >= minBidIncrement
      }
    })

    // Get players purchased by each bidder
    const purchasedPlayers = auction.players.filter(p => p.status === 'SOLD' && p.soldTo)
    const teamCompositions = biddersContext.map(bidder => {
      const purchased = purchasedPlayers.filter(p => p.soldTo === bidder.id)
      return {
        bidderId: bidder.id,
        teamName: bidder.teamName,
        players: purchased.map(p => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = p.data as any
          return {
            name: data?.Name || data?.name || 'Unknown',
            speciality: data?.Speciality || 'N/A',
            batting: data?.['Batting Type'] || 'N/A',
            bowling: data?.['Bowling Type'] || 'N/A',
            price: p.soldPrice || 0
          }
        })
      }
    })
    
    // Analyze team needs for each bidder (dynamic based on sold players)
    const teamNeedsAnalysis = biddersContext.map(bidder => {
      const purchased = purchasedPlayers.filter(p => p.soldTo === bidder.id)
      return analyzeTeamNeeds(bidder.id, bidder.teamName || 'Unknown', purchased, auctionState)
    })
    
    // Get nominated priorities for each bidder (if available)
    const biddersWithPriorities = biddersContext.map(b => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nominatedPriorities = (b as any).nominatedPriorities || null
      return {
        ...b,
        nominatedPriorities
      }
    })

    // Prepare prompt for OpenAI using the comprehensive APL 2026 format
    const currentBidAmount = bidHistory.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? Math.max(...bidHistory.map((b: any) => b.amount || 0))
      : 0

    const prompt = `You are an expert auction analyst for the Assetz Premier League (APL) 2026 cricket auction. Analyze the provided data strictly based on the auction rules from the rulebook, without inventing, modifying, or using mock data. All predictions must derive solely from the input data: player details, bidders' information, team compositions, bid history, and auction context. Use the mind map of factors to evaluate matches between the player and each bidder for intent, aggressiveness, and price predictions.

AUCTION RULES FROM RULEBOOK (STRICTLY ADHERE):

- **CRITICAL BUDGET RULE**: Each bidder starts with ${totalPurse.toLocaleString('en-IN')} points (${(totalPurse / 1000).toFixed(0)}k points) and **MUST SPEND THE ENTIRE BUDGET**. Bidders cannot end with unspent points - they must acquire enough players to consume all ${totalPurse.toLocaleString('en-IN')} points. This means:
  * Early in auction: Bidders may be more conservative to save for high-value players
  * Mid auction: Bidders balance spending based on remaining budget and upcoming players
  * Late auction: Bidders MUST be aggressive to spend remaining budget (they have limited players left to buy)
  * **Budget pressure increases as auction progresses** - bidders with high remaining purse will bid more aggressively later

- Base Price: ${(playerData?.['Base Price'] || playerData?.['base price'] || 1000)} points (${((playerData?.['Base Price'] || playerData?.['base price'] || 1000) / 1000).toFixed(0)}k) per player.

- Bid Increments: ${minBidIncrement} points (${(minBidIncrement / 1000).toFixed(0)}k) gap until 10,000 points, then ${minBidIncrement >= 2000 ? minBidIncrement : 2000} points (${((minBidIncrement >= 2000 ? minBidIncrement : 2000) / 1000).toFixed(0)}k) each. Bidders can start from higher amounts.

- Team Size: 12 players per team, including the bidder.

- Minimum Spend: At least ${minBidIncrement} points per player; no freebies.

- Pre-Auction: Bidders nominate top 3 priorities to form 'Bidders Choice' pool of 15 players (based on votes, ties resolved by second vote or MVP rankings).

- Auction Process: Starts with 'Bidders Choice', then rest of roster. Each player auctioned once; unsold to reserve pool. If teams not full, random allocation from reserve at ${minBidIncrement} points each.

- Bidding: Clear paddle raise; auctioneer judges simultaneous raises.

- Replacements: Like-for-like by Grievance Committee (GC) post-auction; no backfill for partial availability.

- Other: No overseas restrictions; focus on men's category.

MIND MAP OF FACTORS (Use to Score Matches; Weights Based on Bidder Strategy and Data):

- Player-Related Factors (Intrinsic value; score 0-10 for match to bidder needs):

  - Performance Metrics: Runs scored, wickets taken, batting average/strike rate, bowling average/economy, recent form, match-winning contributions.

  - Role and Skills: Batsman, bowler, all-rounder, wicket-keeper; secondary skills (fielding, versatility); play style (aggressive for T20).

  - Experience and Demographics: Age (youth for potential, older for reliability); IPL/international/domestic experience (capped/uncapped); injury history/fitness.

  - Intangibles: Stardom, marketability, leadership/captaincy potential, availability, reputation.

- Bidder/Team-Related Factors (Constraints; score how player fills gaps):

  - Squad Composition: Current balance (e.g., need for batsmen/bowlers); depth; retention impact.

  - Budget: Remaining points; allocation strategy (e.g., save for marquee players).

  - Strategic Priorities: Focus on youth/long-term vs. short-term wins; risk tolerance; team goals.

- Auction/Market-Related Factors (External; adjust for competition):

  - Dynamics: Base price, auction order, competition level (number of interested bidders).

  - Market: Supply/demand for similar players; economic factors; winner's curse risk.

CURRENT PLAYER:

- Name: ${playerData?.Name || 'Unknown'}

- Speciality: ${playerData?.Speciality || 'N/A'}

- Batting: ${playerData?.['Batting Type'] || 'N/A'}

- Bowling: ${playerData?.['Bowling Type'] || 'N/A'}

- Base Price: ${(playerData?.['Base Price'] || playerData?.['base price'] || 1000)} points

- **PLAYER STATISTICS** (Critical for performance evaluation):
  * Matches: ${playerData?.Matches || playerData?.matches || 'N/A'}
  * Runs: ${playerData?.Runs || playerData?.runs || 'N/A'}
  * Batting Average: ${playerData?.Average || playerData?.Avg || playerData?.average || 'N/A'}
  * Economy Rate: ${playerData?.Economy || playerData?.Eco || playerData?.eco || 'N/A'}
  * Wickets: ${playerData?.Wickets || playerData?.wickets || 'N/A'}
  * Catches: ${playerData?.Catches || playerData?.catches || 'N/A'}
  * Strength: ${playerData?.Strength || playerData?.strength || 'N/A'}

${Object.keys(customColumnsData).length > 0 ? `- Custom Analytics Columns:\n${Object.entries(customColumnsData).map(([key, value]) => `  * ${key}: ${value || 'N/A'}`).join('\n')}` : ''}

- **STATS-BASED SCORING ANALYSIS** (Critical for price predictions):
  * Overall Rating: ${playerScore.overallRating}/100
  * Batting Score: ${playerScore.breakdown?.battingScore || 0}/100
  * Bowling Score: ${playerScore.breakdown?.bowlingScore || 0}/100
  * Experience Score: ${playerScore.breakdown?.experienceScore || 0}/100
  * Form Score: ${playerScore.breakdown?.formScore || 0}/100
  * Allrounder Bonus: +${playerScore.breakdown?.allrounderBonus || 0}
  * Keeper Bonus: +${playerScore.breakdown?.keeperBonus || 0}
  * **Stats-Based Predicted Price: ₹${playerScore.predictedPrice.toLocaleString('en-IN')}** (Range: ₹${playerScore.minPrice.toLocaleString('en-IN')} - ₹${playerScore.maxPrice.toLocaleString('en-IN')})
  * Reasoning: ${playerScore.reasoning}

- Full Player Data: ${JSON.stringify(playerData, null, 2)}

- Availability: ${playerData?.Availability || 'Full'} (both weekends or one)

CURRENT AUCTION STATE:

- Current Bid: ₹${currentBidAmount.toLocaleString('en-IN')}
- Minimum Increment: ₹${minBidIncrement.toLocaleString('en-IN')}
- Tushar Remaining Purse: ₹${tusharBidder.remainingPurse.toLocaleString('en-IN')}
- Tushar Remaining Slots: ${(() => {
  const targetTeamSize = 12
  const purchased = teamCompositions.find(t => t.bidderId === tusharBidder.id)?.players.length || 0
  return Math.max(0, targetTeamSize - (purchased + 1))
})()}
- Must Spend Per Slot (if slots remaining): ₹${(() => {
  const targetTeamSize = 12
  const purchased = teamCompositions.find(t => t.bidderId === tusharBidder.id)?.players.length || 0
  const remainingSlots = Math.max(0, targetTeamSize - (purchased + 1))
  if (remainingSlots === 0) return 0
  return Math.round(tusharBidder.remainingPurse / remainingSlots).toLocaleString('en-IN')
})()}

${brilliantUpcomingPlayers && brilliantUpcomingPlayers.length > 0 ? `\n**UPCOMING HIGH-VALUE PLAYERS** (CRITICAL FOR BIDDING STRATEGY):
These players have NOT YET come up in the auction but have high stats/ratings. Bidders with high remaining purse may save budget for these players, making them LESS aggressive on current player.

${brilliantUpcomingPlayers.slice(0, 10).map(p => {
  const statsInfo = p.statsScore ? `Stats Rating: ${p.overallRating}/100, Predicted Price: ₹${p.predictedPrice.toLocaleString('en-IN')}` : 'No stats available'
  return `- ${p.name} (${p.speciality}) - Brilliance Score: ${p.brillianceScore} - ${statsInfo} - Factors: ${p.factors.join(', ')}`
}).join('\n')}

**STRATEGIC IMPACT**: If bidders have high remaining purse (${(() => {
  const highPurseBidders = biddersContext.filter(b => {
    const remainingPercent = b.initialPurse > 0 ? (b.remainingPurse / b.initialPurse) * 100 : 0
    return remainingPercent > 60
  })
  return highPurseBidders.length
})()} bidders with >60% purse remaining) and ${brilliantUpcomingPlayers.length} high-value players coming up, they may be LESS aggressive on current player to save budget. Factor this into probability calculations.\n` : ''}

BIDDERS (Detailed Analysis):

IMPORTANT: Each bidder has a unique ID that MUST be used. Use exact bidderId, teamName, and bidderName provided.

${biddersWithPriorities.map(b => {
  const composition = teamCompositions.find(t => t.bidderId === b.id)
  const players = composition?.players || []
  const specialities = players.map(p => p.speciality)
  const battingTypes = players.map(p => p.batting).filter(Boolean)
  const bowlingTypes = players.map(p => p.bowling).filter(Boolean)
  
  // Calculate budget pressure (how much they MUST spend per remaining player)
  const targetTeamSize = 12 // Including bidder
  const remainingSlots = Math.max(0, targetTeamSize - (b.playersPurchased + 1)) // +1 for bidder
  const mustSpendPerRemainingPlayer = remainingSlots > 0 ? b.remainingPurse / remainingSlots : b.remainingPurse
  const budgetPressure = b.remainingPurse > 0 && remainingSlots > 0 
    ? (mustSpendPerRemainingPlayer > (totalPurse / targetTeamSize) * 1.5 ? 'HIGH' : 
       mustSpendPerRemainingPlayer > (totalPurse / targetTeamSize) ? 'MEDIUM' : 'LOW')
    : 'N/A'
  
  // Calculate aggressiveness factor based on team composition and budget
  const teamNeeds = teamNeedsAnalysis.find(t => t.bidderId === b.id)
  const hasUrgentNeeds = teamNeeds && teamNeeds.urgency >= 7
  const hasHighBudgetPressure = budgetPressure === 'HIGH'
  const aggressivenessFactor = hasUrgentNeeds && hasHighBudgetPressure ? 'VERY HIGH' :
                               hasUrgentNeeds || hasHighBudgetPressure ? 'HIGH' :
                               teamNeeds && teamNeeds.urgency >= 5 ? 'MEDIUM' : 'LOW'
  
  return `
- Bidder ID: ${b.id}
  Team Name: ${b.teamName || b.name || 'Unknown'}
  Bidder Name: ${b.name || b.teamName || 'Unknown'}
  * Remaining Points: ${b.remainingPurse} (${(100 - b.purseUtilization).toFixed(1)}% remaining)
  * Total Spent: ${b.spent} (${b.purseUtilization.toFixed(1)}% utilized)
  * Players Purchased: ${b.playersPurchased} / ${targetTeamSize - 1} needed (${remainingSlots} slots remaining)
  * Average Spent per Player: ${b.avgSpentPerPlayer}
  * **BUDGET PRESSURE**: ${budgetPressure} - Must spend ₹${Math.round(mustSpendPerRemainingPlayer).toLocaleString('en-IN')} per remaining player slot (${remainingSlots} slots left)
  * **AGGRESSIVENESS FACTOR**: ${aggressivenessFactor} (based on team needs + budget pressure)
  * Can Afford Next Bid: ${b.canAfford ? 'Yes' : 'No'}
  * Team Composition:
    - Specialities: ${[...new Set(specialities)].join(', ') || 'None'}
    - Batting Types: ${[...new Set(battingTypes)].join(', ') || 'None'}
    - Bowling Types: ${[...new Set(bowlingTypes)].join(', ') || 'None'}
  * Team Needs Analysis (Dynamic - based on sold players):
    - Needs more batters: ${battingTypes.length < 3 ? 'Yes' : 'No'}
    - Needs more bowlers: ${bowlingTypes.length < 3 ? 'Yes' : 'No'}
    - Needs allrounders: ${!specialities.includes('Allrounder') ? 'Yes' : 'No'}
  * Nominated Priorities: ${b.nominatedPriorities?.join(', ') || 'None'} (if available)
  * **DYNAMIC TEAM NEEDS**: ${(() => {
      const teamNeeds = teamNeedsAnalysis.find(t => t.bidderId === b.id)
      if (teamNeeds) {
        return `Needs: ${teamNeeds.needs.join(', ') || 'Balanced'}, Urgency: ${teamNeeds.urgency}/10 - ${teamNeeds.reasoning}`
      }
      return 'Not calculated'
    })()}
`
}).join('')}

TEAM COMPOSITIONS:

${teamCompositions.map(t => `
- ${t.teamName}:
  ${t.players.map(p => `  * ${p.name} (${p.speciality}) - ${p.price} points`).join('\n')}
`).join('')}

BID HISTORY FOR THIS PLAYER:

${bidHistory.length > 0 ? bidHistory.map(b => `- ${b.bidderName || 'Unknown'} (${b.teamName || 'Unknown'}): ${b.amount || 'N/A'} points`).join('\n') : 'No bids yet'}

TUSHAR'S BIDDER INFO:

- Team: ${tusharBidder.teamName || tusharBidder.username}

- Remaining Points: ${tusharBidder.remainingPurse}

- Purchased: ${teamCompositions.find(t => t.bidderId === tusharBidder.id)?.players.length || 0} players

AUCTION CONTEXT:

- Total Bidders: ${auction.bidders.length} (or as provided)

- 'Bidders Choice' Pool: ${biddersChoicePool ? biddersChoicePool.join(', ') : 'Not specified'}

- Auction Stage: ${auctionState.auctionStage} (Progress: ${auctionState.progressPercent.toFixed(1)}% - ${auctionState.soldCount} sold, ${auctionState.availableCount} available)

- Competition Level: ${competitionLevel}

- **REMAINING PLAYER POOL ANALYSIS**:
  * Total Available Players: ${auctionState.availableCount}
  * Available by Speciality:
    - Bowlers: ${poolSummary.bowlersLeft} available
    - Batters: ${poolSummary.battersLeft} available
    - Allrounders: ${poolSummary.allroundersLeft} available
    - Wicket Keepers: ${poolSummary.keepersLeft} available
  * Current Player Pool Impact: ${poolImpact.toUpperCase()} supply (${poolImpact === 'high' ? 'many similar players left - may reduce aggression' : poolImpact === 'medium' ? 'moderate supply - standard bidding' : 'low supply - high demand, expect higher prices'})
  * **CRITICAL**: If many ${playerSpeciality} players remain unsold (${auctionState.playersBySpeciality[playerSpeciality]?.available || 0} available), bidders may be LESS aggressive on current player to save purse for better options. Factor this into probability and maxBid calculations.

CRITICAL RULES - DO NOT VIOLATE:

1. DO NOT create, modify, invent, or use mock data for players, bidders, teams, bids, or any values. All data is CONSTANT and provided above.

2. DO NOT generate duplicates. Each bidderId appears ONLY ONCE in arrays.

3. Use ONLY exact bidderId, teamName, bidderName from BIDDERS list.

4. Base analysis ONLY on provided data: player details/custom columns, bidder points/utilization, compositions, bid history, rules.

5. **CRITICAL: Use the STATS-BASED SCORING ANALYSIS and PLAYER STATISTICS above to inform your recommendations. The stats-based predicted price is calculated from actual performance data (Runs, Wickets, Matches, Average, Economy, etc.) and should heavily influence your price predictions and recommendations. If a player has strong stats (high Runs, Wickets, good Average/Economy), they should be valued higher.**

6. **CRITICAL: FULL BUDGET CONSUMPTION RULE**: Every bidder MUST spend their entire ${totalPurse.toLocaleString('en-IN')} budget. This creates strategic pressure:
   - Bidders with HIGH remaining purse (>60%) and many players left to buy: May be LESS aggressive now to save for upcoming high-value players
   - Bidders with HIGH remaining purse (>60%) but FEW players left to buy: Will be VERY AGGRESSIVE (must spend remaining budget)
   - Bidders with LOW remaining purse (<40%): Will be MORE selective and aggressive only on players that fill critical team gaps
   - **Budget pressure increases as auction progresses** - factor this into aggressiveness and maxBid calculations

7. **CRITICAL: UPCOMING HIGH-VALUE PLAYERS IMPACT**: The UPCOMING PLAYERS ANALYSIS above shows players with high stats/ratings that haven't come up yet. Bidders with high remaining purse will consider saving budget for these players, making them LESS aggressive on current player. Factor this into probability and maxBid calculations.

8. **CRITICAL: TEAM COMPOSITION & AGGRESSIVENESS**: Use the Team Composition and Aggressiveness Factor for each bidder to determine bidding behavior:
   - HIGH aggressiveness + urgent team needs = Very likely to bid, higher maxBid
   - HIGH aggressiveness + balanced team = Likely to bid, moderate maxBid
   - LOW aggressiveness + urgent needs = May bid, lower maxBid
   - LOW aggressiveness + balanced team = Less likely to bid

9. For predictions, use mind map factors to compute match scores (0-100): 40% Player-Related (use stats heavily here), 30% Bidder-Related (consider team composition, budget pressure, aggressiveness factor), 30% Auction-Related (upcoming players, competition).

7. Intent Probability: Sigmoid of match score (1 / (1 + exp(-0.1 * (score - 50))) * 100).

8. Aggressiveness: Low (<40 match), Medium (40-70), High (>70); adjust for purse and needs.

9. Price Predictions: Use stats-based predicted price as baseline. Probable = statsPredictedPrice + (match / 100) * (performance premium from custom columns + intangibles); Min = probable - 20% variability; Max = probable + 30%; Avg = mean. Cap by remaining points; adhere to increments.

10. Account for interactions: High intent across bidders inflates max prices.

11. If upcoming strong players (from context), high-purse bidders less aggressive now.

12. Custom columns critical for refining (e.g., ratings impact premiums).

Provide a JSON response with:

1. likelyBidders: Array of objects, one per bidder:

   - bidderId: Exact from data

   - teamName: Exact from data

   - intentProbability: 0-100

   - aggressiveness: Low/Medium/High

   - probablePrice: Number (points)

   - minPrice: Number

   - maxPrice: Number

   - averagePrice: Number

   - reasoning: **DETAILED, SPECIFIC analysis** (minimum 2-3 sentences) explaining:
     * Why this bidder is likely/unlikely to bid (reference their team composition, budget pressure, aggressiveness factor, remaining slots)
     * How their current team needs align with this player (specific gaps: batters, bowlers, allrounders, keepers)
     * Budget considerations (remaining purse %, must spend per slot, upcoming high-value players impact)
     * Competition factors (how many other bidders, their aggressiveness)
     * Example: "Falcon has 100% purse remaining (₹100,000) with 11 slots to fill, requiring ₹9,091 per slot. Team currently has 0 players, urgently needs allrounders and bowlers. With 3 high-value upcoming players (Sandeepan, etc.), Falcon may save budget for them. However, this player's strong stats (Rating 57/100, Predicted ₹21k) and allrounder bonus (+25) make them valuable. Competition is medium (2-3 likely bidders). Aggressiveness: MEDIUM - may bid up to ₹14k if price stays reasonable."

2. recommendedAction: { action: 'bid/pass/wait', suggestedBuyPrice: Number, recommendedBid: Number (optional, only if action is 'bid'), reasoning: String, confidence: 0-1 }
   - **CRITICAL**: suggestedBuyPrice is the TARGET PRICE at which to buy the player (not the next bid increment). It MUST align with stats-based predicted price when available. If stats-based price is ₹21,000, suggestedBuyPrice should be ₹15,000-₹18,000 (70-85% of stats price, representing good value), NOT ₹1,000.
   - **CRITICAL PRICE CHECK**: If the current bid exceeds the suggestedBuyPrice by more than 10%, you MUST set action to 'pass' and explain that the price has exceeded the target. The suggestedBuyPrice should remain the same (it's the target), but the action must change to 'pass' when price goes too high. Check the bidHistory to get the current highest bid amount.
   - suggestedBuyPrice: The price at which this player represents good value. Calculate as 70-85% of stats-based predicted price (if available), or 75-80% of estimated final price. This is the strategic target price for purchasing.
   - recommendedBid: (Optional, only if action is 'bid') The next bid increment amount (current bid + min increment). This is for immediate action, while suggestedBuyPrice is the strategic target.
   - reasoning: **DETAILED, SPECIFIC analysis** (minimum 3-4 sentences) explaining:
     * Why this action (bid/pass/wait) is recommended for the current bidder (Tushar/Falcon)
     * **If current bid exceeds suggestedBuyPrice**: Clearly state "PRICE EXCEEDED: Current bid (₹X) has exceeded your suggested buy price (₹Y) by ₹Z. Consider passing and saving budget."
     * How stats-based predicted price (₹X) compares to suggestedBuyPrice and estimated final price
     * Team composition analysis (what gaps this player fills, urgency)
     * Budget strategy (remaining purse %, must spend per slot, upcoming players consideration)
     * Competition assessment (number of likely bidders, their aggressiveness)
     * Specific suggestedBuyPrice and reasoning (must reference stats-based price if available)
     * Example: "RECOMMENDATION: WAIT with suggested buy price of ₹15,000. This player (Gaurav) has strong stats (Overall Rating 57/100, Stats-Based Predicted Price ₹21,000) with allrounder bonus. However, you have 100% purse remaining (₹100,000) with 11 slots to fill, requiring ₹9,091 per slot. With 3 high-value upcoming players coming, consider saving budget. Current competition is medium (2-3 likely bidders). Suggested buy price ₹15,000 (71% of stats price) represents good value - consider buying if price stays below this."
     * Example when price exceeded: "RECOMMENDATION: PASS. PRICE EXCEEDED: Current bid (₹41,000) has exceeded your suggested buy price (₹22,000) by ₹19,000 (86% above target). While this player has strong stats (Overall Rating 100/100, Stats-Based Predicted Price ₹35,000), the current price no longer represents good value. Consider passing and saving your budget for better opportunities."
   - **VALIDATION CHECKLIST** (execute before finalizing JSON):
     1. Determine 'currentBid' from 'bidHistory' (0 if none) and ensure all price outputs are multiples of 1,000.
     2. If currentBid > suggestedBuyPrice * 1.1, set action to 'pass' and explicitly mention the overage in reasoning.
     3. Ensure recommendedBid, when provided, is greater than currentBid and equals currentBid + minIncrement.
     4. If Tushar (the focus bidder) has zero remaining purse or zero roster slots, force action to 'pass' and explain why.

3. marketAnalysis: 

   - averageBid: Calculate from bid history (0 if none)

   - highestBid: From history (0 if none)

   - competitionLevel: low/medium/high

   - teamNeeds: Array of { bidderId, teamName, needs: [strings], urgency: 0-10 }

   - overallSummary: { topBidderId: String, expectedFinalPrice: Number, biddingWarLikelihood: Low/Medium/High }

Return ONLY valid JSON, no other text.`

    // Call OpenAI (only if requested and available)
    let predictions
    const openai = shouldUseOpenAI ? getOpenAI() : null
    if (openai && shouldUseOpenAI) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert auction analyst. Always respond with valid JSON only, no markdown or code blocks.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        })

        const responseText = completion.choices[0]?.message?.content || '{}'
        
        // Clean the response text - remove markdown code blocks if present
        let cleanedText = responseText.trim()
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }
        
        // Parse JSON with error handling
        let parsed
        try {
          parsed = JSON.parse(cleanedText)
        } catch (parseError) {
          console.error('JSON parse error:', parseError)
          console.error('Response text:', cleanedText.substring(0, 500)) // Log first 500 chars
          // If parsing fails, use fallback
          throw new Error('Failed to parse OpenAI response as JSON')
        }
        
        // Validate parsed object
        if (!parsed || typeof parsed !== 'object') {
          console.error('Invalid parsed object:', parsed)
          throw new Error('OpenAI response is not a valid object')
        }
        
        // Validate and ensure all required fields exist
        // Deduplicate likelyBidders by bidderId
        const seenBidderIds = new Set<string>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uniqueLikelyBidders = (parsed.likelyBidders || []).filter((b: any) => {
          const bidderId = b.bidderId || ''
          if (!bidderId || seenBidderIds.has(bidderId)) {
            return false // Skip duplicates
          }
          seenBidderIds.add(bidderId)
          return true
        })
        
        // Get current bid and base price for calculations (no mock data)
        // Round current bid to nearest 1000 to ensure it's in multiples of 1000
        const rawCurrentBid = bidHistory.length > 0 ? bidHistory[0]?.amount || 0 : 0
        const currentBidForValidation = roundToNearestThousand(rawCurrentBid)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const basePriceForValidation = (currentPlayer.data as any)?.['Base Price'] || (currentPlayer.data as any)?.['base price'] || 1000
        const minIncrementForValidation = currentBidForValidation >= 10000 ? 2000 : 1000
        
        predictions = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          likelyBidders: uniqueLikelyBidders.map((b: any) => {
            // Find the actual bidder from auction to get real names
            // Try multiple lookup strategies
            let actualBidder = auction.bidders.find(bid => bid.id === b.bidderId)
            
            // If not found by ID, try to match by team name or bidder name
            if (!actualBidder && b.teamName) {
              actualBidder = auction.bidders.find(bid => 
                bid.teamName?.toLowerCase() === b.teamName?.toLowerCase() ||
                bid.user?.name?.toLowerCase() === b.teamName?.toLowerCase() ||
                bid.username?.toLowerCase() === b.teamName?.toLowerCase()
              )
            }
            
            if (!actualBidder && b.bidderName) {
              actualBidder = auction.bidders.find(bid => 
                bid.user?.name?.toLowerCase() === b.bidderName?.toLowerCase() ||
                bid.username?.toLowerCase() === b.bidderName?.toLowerCase() ||
                bid.teamName?.toLowerCase() === b.bidderName?.toLowerCase()
              )
            }
            
            // Debug logging
            if (!actualBidder) {
              console.log(`[Analytics] Bidder not found for ID: ${b.bidderId}, teamName: ${b.teamName}, bidderName: ${b.bidderName}`)
              console.log(`[Analytics] Available bidders:`, auction.bidders.map(bid => ({
                id: bid.id,
                teamName: bid.teamName,
                username: bid.username,
                userName: bid.user?.name
              })))
            }
            
            // Always use actual bidder data if found, otherwise use AI response
            const actualTeamName = actualBidder?.teamName || b.teamName || ''
            const actualBidderName = actualBidder?.user?.name || actualBidder?.username || b.bidderName || ''
            
            // Use the actual bidder ID if we found a match
            const finalBidderId = actualBidder?.id || b.bidderId || ''
            
            // Handle both old format (probability 0-1, maxBid) and new format (intentProbability 0-100, maxPrice/probablePrice)
            // Convert intentProbability (0-100) to probability (0-1) if present
            let probability = 0
            if (typeof b.intentProbability === 'number') {
              probability = b.intentProbability / 100 // Convert 0-100 to 0-1
            } else if (typeof b.probability === 'number') {
              probability = b.probability
            }
            
            // Round all price values from AI response FIRST (before any calculations)
            // This ensures all values are in multiples of 1000
            const roundedProbablePrice = b.probablePrice ? roundToNearestThousand(b.probablePrice) : undefined
            const roundedMinPrice = b.minPrice ? roundToNearestThousand(b.minPrice) : undefined
            const roundedMaxPrice = b.maxPrice ? roundToNearestThousand(b.maxPrice) : undefined
            const roundedAveragePrice = b.averagePrice ? roundToNearestThousand(b.averagePrice) : undefined
            const roundedMaxBidFromAI = b.maxBid ? roundToNearestThousand(b.maxBid) : 0
            
            // Get maxBid from new format (maxPrice) or old format (maxBid) - use ROUNDED values
            let finalMaxBid = 0
            if (roundedMaxPrice && roundedMaxPrice > 0) {
              finalMaxBid = roundedMaxPrice
            } else if (roundedProbablePrice && roundedProbablePrice > 0) {
              finalMaxBid = roundedProbablePrice
            } else if (roundedMaxBidFromAI > 0) {
              finalMaxBid = roundedMaxBidFromAI
            }
            
            // Calculate reasonable max bid from actual data
            const basePrice = basePriceForValidation
            const reasonableMaxBid = actualBidder ? Math.min(
              actualBidder.remainingPurse * 0.4, // Max 40% of remaining purse
              currentBidForValidation > 0 
                ? currentBidForValidation * 3 // Max 3x current bid
                : basePrice * 10, // Max 10x base price if no bids
              actualBidder.remainingPurse - minIncrementForValidation // Leave room for at least one more bid
            ) : basePrice + minIncrementForValidation
            
            // Round reasonableMaxBid to nearest 1000
            const roundedReasonableMaxBid = roundToNearestThousand(reasonableMaxBid)
            
            // If maxBid is 0 or invalid, use calculated value
            if (finalMaxBid === 0) {
              finalMaxBid = Math.max(
                basePrice + minIncrementForValidation,
                roundedReasonableMaxBid
              )
            } else {
              // Validate AI's maxBid - cap it at reasonable limits (using rounded values)
              finalMaxBid = Math.min(
                finalMaxBid,
                roundedReasonableMaxBid,
                actualBidder ? roundToNearestThousand(actualBidder.remainingPurse * 0.5) : 100000 // Never exceed 50% of purse or 100k
              )
            }
            
            // Final validation: ensure it's at least base price + increment (rounded)
            const minBid = roundToNearestThousand(basePrice + minIncrementForValidation)
            finalMaxBid = Math.max(finalMaxBid, minBid)
            
            // Final round to ensure it's in multiples of 1000 (should already be, but double-check)
            const roundedMaxBid = roundToNearestThousand(finalMaxBid)
            
            // Adjust maxBid based on pool supply impact (if poolImpact is available)
            let poolAdjustedMaxBid = roundedMaxBid
            const availableSimilarPlayersForBidder = auctionState?.playersBySpeciality[playerSpeciality]?.available || 0
            if (poolImpact && poolImpact === 'high' && availableSimilarPlayersForBidder >= 15) {
              // Reduce maxBid by 15% if high supply
              poolAdjustedMaxBid = roundToNearestThousand(roundedMaxBid * 0.85)
            } else if (poolImpact && poolImpact === 'low' && availableSimilarPlayersForBidder < 5) {
              // Increase maxBid by 12% if low supply
              poolAdjustedMaxBid = roundToNearestThousand(roundedMaxBid * 1.12)
            }
            
            return {
              bidderId: finalBidderId,
              bidderName: actualBidderName || actualTeamName || 'Unknown Bidder',
              teamName: actualTeamName || actualBidderName || 'Unknown Team',
              probability: probability,
              maxBid: poolAdjustedMaxBid, // Use pool-adjusted maxBid
              reasoning: b.reasoning || 'No reasoning provided',
              // Include new format fields if present (rounded)
              ...(b.aggressiveness && { aggressiveness: b.aggressiveness }),
              ...(roundedProbablePrice && { probablePrice: roundedProbablePrice }),
              ...(roundedMinPrice && { minPrice: roundedMinPrice }),
              ...(roundedMaxPrice && { maxPrice: roundedMaxPrice }),
              ...(roundedAveragePrice && { averagePrice: roundedAveragePrice }),
              // Include pool impact info
              poolAdjustedMax: poolAdjustedMaxBid !== roundedMaxBid ? poolAdjustedMaxBid : undefined,
              poolImpact: poolImpact
            }
          }),
          recommendedAction: (() => {
            // Extract and validate AI response
            let action = parsed.recommendedAction?.action || 'wait'
            let suggestedBuyPrice = typeof parsed.recommendedAction?.suggestedBuyPrice === 'number'
              ? roundToNearestThousand(parsed.recommendedAction.suggestedBuyPrice)
              : (typeof parsed.recommendedAction?.recommendedAmount === 'number'
                ? roundToNearestThousand(parsed.recommendedAction.recommendedAmount) // Fallback to recommendedAmount
                : undefined)
            let recommendedBid = typeof parsed.recommendedAction?.recommendedBid === 'number'
              ? roundToNearestThousand(parsed.recommendedAction.recommendedBid)
              : undefined
            let reasoning = parsed.recommendedAction?.reasoning || 'No recommendation available'
            let confidence = typeof parsed.recommendedAction?.confidence === 'number' 
              ? parsed.recommendedAction.confidence 
              : 0.5
            
            // CRITICAL VALIDATION: If current bid exceeds suggested buy price, override action
            if (suggestedBuyPrice && currentBidForValidation > 0 && currentBidForValidation > suggestedBuyPrice) {
              const excessPercent = ((currentBidForValidation - suggestedBuyPrice) / suggestedBuyPrice * 100).toFixed(0)
              const excessAmount = currentBidForValidation - suggestedBuyPrice
              
              // If significantly above (more than 10%), change to PASS
              if (excessAmount > suggestedBuyPrice * 0.1) {
                action = 'pass'
                reasoning = `PRICE EXCEEDED: Current bid (₹${currentBidForValidation.toLocaleString('en-IN')}) has exceeded your suggested buy price (₹${suggestedBuyPrice.toLocaleString('en-IN')}) by ₹${excessAmount.toLocaleString('en-IN')} (${excessPercent}% above target). ${reasoning} Consider passing and saving your budget for better opportunities.`
                confidence = 0.85
                recommendedBid = undefined
              } else {
                // If slightly above, change to WAIT
                action = 'wait'
                reasoning = `⚠️ WARNING: Current bid (₹${currentBidForValidation.toLocaleString('en-IN')}) exceeds your suggested buy price (₹${suggestedBuyPrice.toLocaleString('en-IN')}). ${reasoning} Consider carefully before bidding further.`
                confidence = Math.max(0.5, confidence - 0.1)
                recommendedBid = undefined
              }
            }
            
            // Validate recommendedBid is higher than current bid
            if (recommendedBid && currentBidForValidation > 0 && recommendedBid <= currentBidForValidation) {
              recommendedBid = currentBidForValidation + minIncrementForValidation
            }
            
            return {
              action,
              suggestedBuyPrice,
              recommendedBid,
              reasoning,
              confidence
            }
          })(),
          marketAnalysis: {
            // Only use AI's averageBid if bidHistory exists, otherwise use calculated value
            // Round to nearest 1000 (bids must be in multiples of 1000)
            averageBid: bidHistory.length > 0 
              ? (typeof parsed.marketAnalysis?.averageBid === 'number' 
                  ? roundToNearestThousand(parsed.marketAnalysis.averageBid)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  : roundToNearestThousand(bidHistory.reduce((sum: number, b: any) => sum + (b.amount || 0), 0) / bidHistory.length))
              : 0,
            // Only use AI's highestBid if bidHistory exists, otherwise use calculated value
            // Round to nearest 1000 (bids must be in multiples of 1000)
            highestBid: bidHistory.length > 0
              ? (typeof parsed.marketAnalysis?.highestBid === 'number' 
                  ? roundToNearestThousand(parsed.marketAnalysis.highestBid)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  : roundToNearestThousand(Math.max(...bidHistory.map((b: any) => b.amount || 0))))
              : 0,
            competitionLevel: parsed.marketAnalysis?.competitionLevel || 'low',
            // Include remaining pool impact in market analysis
            remainingPoolImpact: poolImpact,
            remainingPoolSummary: poolSummary,
            // Include overallSummary if present (new format)
            // Round expectedFinalPrice to nearest 1000 if present
            ...(parsed.marketAnalysis?.overallSummary && {
              overallSummary: {
                ...parsed.marketAnalysis.overallSummary,
                ...(typeof parsed.marketAnalysis.overallSummary.expectedFinalPrice === 'number' && {
                  expectedFinalPrice: roundToNearestThousand(parsed.marketAnalysis.overallSummary.expectedFinalPrice)
                })
              }
            }),
            teamNeeds: (() => {
              // Deduplicate by bidderId - keep only the first occurrence
              const seen = new Set<string>()
              return (parsed.marketAnalysis?.teamNeeds || [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((t: any) => {
                  const bidderId = t.bidderId || ''
                  if (!bidderId || seen.has(bidderId)) {
                    return false // Skip duplicates
                  }
                  seen.add(bidderId)
                  return true
                })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((t: any) => {
                  // Find the actual bidder from auction to get real team name
                  // Try multiple lookup strategies
                  let actualBidder = auction.bidders.find(bid => bid.id === t.bidderId)
                  
                  // If not found by ID, try to match by team name
                  if (!actualBidder && t.teamName) {
                    actualBidder = auction.bidders.find(bid => 
                      bid.teamName?.toLowerCase() === t.teamName?.toLowerCase() ||
                      bid.user?.name?.toLowerCase() === t.teamName?.toLowerCase() ||
                      bid.username?.toLowerCase() === t.teamName?.toLowerCase()
                    )
                  }
                  
                  // Always use actual bidder data if found
                  let actualTeamName = actualBidder?.teamName || t.teamName || ''
                  
                  // If still no name, try to get from bidder data
                  if (!actualTeamName && actualBidder) {
                    actualTeamName = actualBidder.user?.name || actualBidder.username || ''
                  }
                  
                  // Use the actual bidder ID if we found a match
                  const finalBidderId = actualBidder?.id || t.bidderId || ''
                  
                  return {
                    bidderId: finalBidderId,
                    teamName: actualTeamName || 'Unknown Team',
                    needs: Array.isArray(t.needs) ? t.needs : [],
                    urgency: typeof t.urgency === 'number' ? t.urgency : 5
                  }
                })
            })()
          },
          upcomingHighValuePlayers: brilliantUpcomingPlayers?.slice(0, 15).map((p: any) => {
            const statsScore = p.statsScore || (p.overallRating ? { overallRating: p.overallRating, breakdown: {} } : null)
            const predictedSpeciality = statsScore ? deriveSpecialityFromStats(statsScore) : (p.speciality || 'Unknown')
            const predictedStats = statsScore ? getPredictedStatsSummary(statsScore) : 'N/A'
            return {
              id: p.id,
              name: p.name,
              speciality: predictedSpeciality, // Use derived speciality
              predictedSpeciality: predictedSpeciality, // Add predicted speciality column
              predictedStats: predictedStats, // Add predicted stats column
              batting: p.batting,
              bowling: p.bowling,
              isIcon: p.isIcon,
              basePrice: p.basePrice,
              brillianceScore: p.brillianceScore,
              overallRating: p.overallRating || p.statsScore?.overallRating || 0,
              predictedPrice: p.predictedPrice || p.statsScore?.predictedPrice || 0,
              minPrice: p.statsScore?.minPrice || 0,
              maxPrice: p.statsScore?.maxPrice || 0,
              factors: p.factors || []
            }
          }) || []
        }
      } catch (error) {
        console.error('OpenAI error:', error)
        // Fallback to basic predictions
        predictions = generateFallbackPredictions(
          biddersContext, 
          currentPlayer, 
          bidHistory, 
          tusharBidder, 
          teamCompositions, 
          auction.bidders, 
          upcomingPlayersAnalysis, 
          brilliantUpcomingPlayers,
          playerScore,
          auctionState,
          teamNeedsAnalysis,
          totalPurse
        )
      }
    } else {
      // No OpenAI requested or not available, use fallback
      console.log('[Analytics] Using fallback predictions (OpenAI not requested or not available)')
      predictions = generateFallbackPredictions(
        biddersContext, 
        currentPlayer, 
        bidHistory, 
        tusharBidder, 
        teamCompositions, 
        auction.bidders, 
        upcomingPlayersAnalysis, 
        brilliantUpcomingPlayers,
        playerScore,
        auctionState,
        teamNeedsAnalysis,
        totalPurse
      )
    }

    return NextResponse.json({ predictions })
  } catch (error) {
    console.error('Analytics error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error details:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json(
      { 
        error: 'Failed to generate predictions',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    )
  }
}

function generateFallbackPredictions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidders: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  player: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidHistory: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tusharBidder: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamCompositions: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auctionBidders: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upcomingPlayersAnalysis?: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brilliantUpcomingPlayers?: any[],
  playerScore?: ScoreResult,
  auctionState?: AuctionState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamNeedsAnalysis?: any[],
  totalPurse: number = 100000
) {
  // Enhanced fallback logic considering all factors
  // Calculate metrics from bid history for THIS player only
  // Round all bid values to nearest 1000 to ensure they're in multiples of 1000
  const rawCurrentBid = bidHistory.length > 0 ? bidHistory[0]?.amount || 0 : 0
  const currentBid = roundToNearestThousand(rawCurrentBid)
  const rawHighestBid = bidHistory.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? Math.max(...bidHistory.map((b: any) => b.amount || 0))
    : 0
  const highestBid = roundToNearestThousand(rawHighestBid)
  const rawAverageBid = bidHistory.length > 0
    ? bidHistory.reduce((sum, b) => sum + (b.amount || 0), 0) / bidHistory.length
    : 0
  const averageBid = roundToNearestThousand(rawAverageBid)
  
  // Determine min increment based on dynamic rule
  const minIncrement = currentBid >= 10000 ? 2000 : 1000

  // Factor in upcoming brilliant players
  const hasBrilliantUpcoming = brilliantUpcomingPlayers && brilliantUpcomingPlayers.length > 0
  const brilliantCount = brilliantUpcomingPlayers?.length || 0
  
  // Get player speciality - derive from stats instead of using column
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerData = player?.data as any
  // Derive speciality from stats-based scoring
  const playerSpeciality = playerScore ? deriveSpecialityFromStats(playerScore) : (playerData?.Speciality || playerData?.speciality || '')
  const poolImpact = auctionState ? calculateRemainingPoolImpact(playerSpeciality, auctionState) : 'medium'
  const availableSimilarPlayers = auctionState?.playersBySpeciality[playerSpeciality]?.available || 0

  // Include Tushar's bidder in the list (but mark them separately)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const tusharBidderData = bidders.find(b => b.id === tusharBidder.id)
  
  const likelyBidders = bidders
    .filter(b => {
      // Don't filter out Tushar - include them in the list
      // Filter bidders who can afford and have need
      if (!b.canAfford) return false
      if (b.remainingPurse < currentBid + minIncrement) return false
      
      // Consider team needs
      const needsBatter = b.teamNeeds?.includes('batter') || b.teamNeeds?.includes('Batter')
      const needsBowler = b.teamNeeds?.includes('bowler') || b.teamNeeds?.includes('Bowler')
      const needsAllrounder = b.teamNeeds?.includes('allrounder') || b.teamNeeds?.includes('Allrounder')
      // Derive speciality from stats instead of using column
      const playerSpeciality = playerScore ? deriveSpecialityFromStats(playerScore) : ((player?.data as any)?.Speciality || '')
      
      // If team has specific needs and player matches, higher probability
      const matchesNeed = (needsBatter && playerSpeciality.includes('Batter')) ||
                         (needsBowler && playerSpeciality.includes('Bowler')) ||
                         (needsAllrounder && playerSpeciality.includes('Allrounder'))
      
      // STRATEGIC FACTOR: If brilliant players are coming and bidder has high purse, they might save
      // But if they have urgent team needs, they might still bid
      const purseRemainingPercent = b.initialPurse > 0 ? (b.remainingPurse / b.initialPurse) * 100 : 0
      const mightSaveForBrilliant = hasBrilliantUpcoming && purseRemainingPercent > 60 && !matchesNeed
      
      // If they might save for brilliant players, be more selective
      if (mightSaveForBrilliant && !matchesNeed && b.remainingPurse > currentBid * 2) {
        // Still include but with lower probability (handled in map)
        return true
      }
      
      return matchesNeed || b.remainingPurse > currentBid * 1.5
    })
    .map(b => {
      // Advanced probability calculation using weighted factors
      // Factor 1: Purse Balance (0-0.35 weight)
      // Use actual total purse from auction rules, not hardcoded value
      const totalPurse = b.initialPurse || 100000 // Use bidder's actual initial purse
      const normalizedPurse = totalPurse > 0 ? Math.min(1, b.remainingPurse / totalPurse) : 0
      const purseFactor = normalizedPurse * 0.35
      
      // Factor 2: Purse Utilization (inverse - lower utilization = higher probability)
      // Utilization < 30%: high probability boost (0.25)
      // Utilization 30-60%: medium boost (0.15)
      // Utilization 60-80%: low boost (0.05)
      // Utilization > 80%: negative impact (-0.1)
      let utilizationFactor = 0
      if (b.purseUtilization < 30) {
        utilizationFactor = 0.25
      } else if (b.purseUtilization < 60) {
        utilizationFactor = 0.15
      } else if (b.purseUtilization < 80) {
        utilizationFactor = 0.05
      } else {
        utilizationFactor = -0.1
      }
      
      // Factor 3: Team Needs Match (0-0.2 weight) - Use dynamic team needs analysis
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamNeeds = (teamNeedsAnalysis as any)?.find((t: any) => t.bidderId === b.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const playerSpeciality = (player?.data as any)?.Speciality || ''
      
      let needFactor = 0
      if (teamNeeds) {
        // Use dynamic team needs analysis
        if (playerSpeciality.includes('Batter') && teamNeeds.needsBatters) {
          needFactor = 0.2 * (teamNeeds.urgency / 10) // Scale by urgency
        } else if (playerSpeciality.includes('Bowler') && teamNeeds.needsBowlers) {
          needFactor = 0.2 * (teamNeeds.urgency / 10)
        } else if (playerSpeciality.includes('Allrounder') && teamNeeds.needsAllrounders) {
          needFactor = 0.2 * (teamNeeds.urgency / 10)
        }
      } else {
        // Fallback to old logic if team needs analysis not available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const composition = teamCompositions.find((t: any) => t.bidderId === b.id)
        const players = composition?.players || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const specialities = players.map((p: any) => p.speciality)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const battingTypes = players.map((p: any) => p.batting).filter(Boolean)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bowlingTypes = players.map((p: any) => p.bowling).filter(Boolean)
        
        if (playerSpeciality.includes('Batter') && battingTypes.length < 3) {
          needFactor = 0.2
        } else if (playerSpeciality.includes('Bowler') && bowlingTypes.length < 3) {
          needFactor = 0.2
        } else if (playerSpeciality.includes('Allrounder') && !specialities.includes('Allrounder')) {
          needFactor = 0.2
        } else if (battingTypes.length < 2 || bowlingTypes.length < 2) {
          needFactor = 0.1 // General team building need
        }
      }
      
      // Factor 4: Spending Pattern (0-0.15 weight)
      // If avg spent per player is reasonable compared to total purse, more likely to bid
      // Use actual total purse to determine reasonable spending threshold (50% of total purse per player is reasonable)
      const totalPurseForBidder = b.initialPurse || 100000
      const reasonableSpendingThreshold = totalPurseForBidder * 0.5 // 50% of total purse per player
      const avgSpentFactor = b.avgSpentPerPlayer > 0 && b.avgSpentPerPlayer < reasonableSpendingThreshold ? 0.15 : 0.05
      
      // Factor 5: Players Purchased Count (0-0.05 weight)
      // Early in auction (few players) = higher probability
      const earlyAuctionFactor = b.playersPurchased < 5 ? 0.05 : 0
      
      // Factor 6: Upcoming Brilliant Players (0 to -0.2 weight) - NEGATIVE impact
      // If brilliant players are coming and bidder has high purse remaining, they might save
      let brilliantPlayerFactor = 0
      const purseRemainingPercent = b.initialPurse > 0 ? (b.remainingPurse / b.initialPurse) * 100 : 0
      
      if (hasBrilliantUpcoming && brilliantCount > 0) {
        // More brilliant players = more incentive to save
        const brilliantImpact = Math.min(0.2, (brilliantCount / 10) * 0.1) // Max -0.2 reduction
        
        // Higher purse remaining = more likely to save
        if (purseRemainingPercent > 70) {
          brilliantPlayerFactor = -brilliantImpact * 1.5 // Strong negative if high purse
        } else if (purseRemainingPercent > 50) {
          brilliantPlayerFactor = -brilliantImpact // Moderate negative
        } else if (purseRemainingPercent > 30) {
          brilliantPlayerFactor = -brilliantImpact * 0.5 // Weak negative
        }
        // If purse < 30%, they need to bid now, so no negative impact
      }
      
      // Factor 7: Remaining Pool Supply Impact (NEW) - NEGATIVE if high supply
      let poolSupplyFactor = 0
      if (poolImpact === 'high' && availableSimilarPlayers >= 15) {
        // High supply of similar players - reduce probability by 15-25%
        poolSupplyFactor = -0.2 * (availableSimilarPlayers / 30) // More available = more reduction
      } else if (poolImpact === 'low' && availableSimilarPlayers < 5) {
        // Low supply - increase probability by 10-15%
        poolSupplyFactor = 0.15 * (1 - availableSimilarPlayers / 5) // Fewer available = more increase
      }
      
      // Calculate final probability with normalization (include pool supply factor)
      const rawProbability = purseFactor + utilizationFactor + needFactor + avgSpentFactor + earlyAuctionFactor + brilliantPlayerFactor + poolSupplyFactor
      const probability = Math.max(0, Math.min(0.95, rawProbability))
      
      // Estimate max bid using stats-based predicted price as baseline
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const basePrice = (player?.data as any)?.['Base Price'] || (player?.data as any)?.['base price'] || 1000
      
      // Use stats-based predicted price if available, otherwise calculate
      const statsPredictedPrice = playerScore?.predictedPrice || (basePrice * 5) // Fallback to 5x base
      
      // Adjust for pool supply impact
      let poolAdjustedPrice = statsPredictedPrice
      if (poolImpact === 'high') {
        poolAdjustedPrice = statsPredictedPrice * 0.85 // Reduce by 15% if high supply
      } else if (poolImpact === 'low') {
        poolAdjustedPrice = statsPredictedPrice * 1.12 // Increase by 12% if low supply
      }
      
      const maxBid = Math.min(
        b.remainingPurse * 0.38, // Max 38% of remaining purse (reduced from 40% for safety)
        currentBid > 0 
          ? currentBid * 3 // Max 3x current bid
          : poolAdjustedPrice, // Use pool-adjusted stats price if no bids
        b.remainingPurse - minIncrement, // Leave room for at least one more bid
        playerScore?.maxPrice || 32000, // Cap at stats maxPrice
        100000 // Hard cap at 100k to prevent unrealistic values
      )
      
      // Ensure maxBid is at least base price + increment
      const minReasonableBid = Math.max(basePrice + minIncrement, minIncrement)
      
      // Build detailed reasoning based on factors
      const factors = []
      if (normalizedPurse > 0.7) factors.push('strong purse balance')
      if (b.purseUtilization < 30) factors.push('low purse utilization')
      if (needFactor > 0.15) factors.push('matches team needs')
      if (avgSpentFactor > 0.1) factors.push('reasonable spending pattern')
      if (earlyAuctionFactor > 0) factors.push('early auction phase')
      
      // Add brilliant players factor to reasoning if applicable
      let brilliantReasoning = ''
      if (hasBrilliantUpcoming && brilliantPlayerFactor < 0) {
        brilliantReasoning = ` Note: ${brilliantCount} brilliant player(s) coming up - may save purse (${Math.round(Math.abs(brilliantPlayerFactor) * 100)}% probability reduction).`
      }
      
      const reasoning = `Probability calculated using advanced model: ${Math.round(purseFactor * 100)}% purse factor, ${Math.round(utilizationFactor * 100)}% utilization factor, ${Math.round(needFactor * 100)}% team needs factor, ${Math.round(avgSpentFactor * 100)}% spending pattern factor${brilliantPlayerFactor !== 0 ? `, ${Math.round(brilliantPlayerFactor * 100)}% upcoming brilliant players factor` : ''}. Has ₹${b.remainingPurse.toLocaleString('en-IN')} remaining (${(100 - b.purseUtilization).toFixed(0)}% of purse unused). ${b.playersPurchased} players purchased, avg ₹${b.avgSpentPerPlayer.toLocaleString('en-IN')} per player. Key factors: ${factors.join(', ') || 'standard bidding pattern'}.${brilliantReasoning}`
      
      // Get actual names from auction bidders
      const actualAuctionBidder = auctionBidders.find(ab => ab.id === b.id)
      const actualTeamName = actualAuctionBidder?.teamName || 
                            actualAuctionBidder?.user?.name || 
                            actualAuctionBidder?.username ||
                            b.teamName || 
                            b.name || 
                            'Unknown Team'
      const actualBidderName = actualAuctionBidder?.user?.name || 
                              actualAuctionBidder?.username ||
                              b.name || 
                              b.teamName || 
                              'Unknown Bidder'
      
      // Ensure maxBid is calculated from actual data only (no mock values)
      // maxBid should be at least the minimum increment, but calculated from real data
      const finalMaxBid = Math.max(
        minReasonableBid, // At least base price + increment
        maxBid // Calculated from actual bidder data (already capped)
      )
      
      // Final safety check: never exceed 50% of remaining purse
      const absoluteMax = b.remainingPurse * 0.5
      const finalMaxBidCapped = Math.min(finalMaxBid, absoluteMax)
      
      // Round to nearest 1000 (bids must be in multiples of 1000)
      const roundedMaxBid = roundToNearestThousand(finalMaxBidCapped)
      
      return {
        bidderId: b.id,
        bidderName: actualBidderName,
        teamName: actualTeamName,
        probability: probability,
        maxBid: roundedMaxBid, // Rounded to nearest 1000
        reasoning: reasoning
      }
    })
    .sort((a, b) => {
      // Sort Tushar's bidder to the top if present
      if (a.bidderId === tusharBidder.id) return -1
      if (b.bidderId === tusharBidder.id) return 1
      return b.probability - a.probability
    })
    .slice(0, 5)

  // Calculate Tushar's team needs
  const tusharPurchased = bidders.find(b => b.id === tusharBidder.id)?.playersPurchased || 0
  const tusharSpent = bidders.find(b => b.id === tusharBidder.id)?.spent || 0
  const tusharAvg = tusharPurchased > 0 ? tusharSpent / tusharPurchased : 0
  const tusharUtilization = bidders.find(b => b.id === tusharBidder.id)?.purseUtilization || 0
  const tusharPurseRemainingPercent = tusharBidder.purseAmount > 0 
    ? (tusharBidder.remainingPurse / tusharBidder.purseAmount) * 100 
    : 0
  
  // Calculate Tushar's remaining slots and must spend per slot (CRITICAL for team formation)
  const targetTeamSize = 12 // Including bidder
  const tusharRemainingSlots = Math.max(0, targetTeamSize - (tusharPurchased + 1)) // +1 for bidder
  const tusharMustSpendPerSlot = tusharRemainingSlots > 0 ? tusharBidder.remainingPurse / tusharRemainingSlots : tusharBidder.remainingPurse
  const tusharBudgetPressure = tusharRemainingSlots > 0 && tusharBidder.remainingPurse > 0
    ? (tusharMustSpendPerSlot > (totalPurse / targetTeamSize) * 1.5 ? 'HIGH' : 
       tusharMustSpendPerSlot > (totalPurse / targetTeamSize) ? 'MEDIUM' : 'LOW')
    : 'N/A'
  
  // Check if Tushar has urgent team needs (needs to fill many slots)
  // Urgent if: (1) 8+ slots remaining, OR (2) must spend per slot > 1.5x average, OR (3) late auction (>70% progress)
  const auctionProgress = auctionState?.progressPercent || 0
  const averageSpendPerSlot = totalPurse / targetTeamSize
  const tusharHasUrgentNeeds = tusharRemainingSlots >= 8 || // Many slots remaining
                               (tusharMustSpendPerSlot > averageSpendPerSlot * 1.5) || // High budget pressure
                               (auctionProgress > 70 && tusharRemainingSlots >= 5) // Late auction with slots remaining
  const tusharNeedsToSpend = tusharRemainingSlots > 0 && tusharBidder.remainingPurse > 0 // Must spend remaining budget
  const urgencyLevel: UrgencyLevel = tusharHasUrgentNeeds
    ? 'HIGH'
    : tusharBudgetPressure === 'MEDIUM'
      ? 'MEDIUM'
      : 'LOW'
  
  // Determine recommended action
  const canAfford = tusharBidder.remainingPurse >= currentBid + minIncrement
  
  // Calculate competition level based on probabilities and aggressiveness, not just count
  const totalCompetition = likelyBidders.reduce((sum, b) => {
    const bidderCompetition = b.probability * (b.maxBid / Math.max(currentBid || basePrice, 1))
    return sum + bidderCompetition
  }, 0)
  const competitionLevel = totalCompetition > 2 ? 'high' : totalCompetition > 1 ? 'medium' : 'low'
  
  // Factor in upcoming brilliant players for Tushar's decision
  const shouldConsiderSaving = hasBrilliantUpcoming && 
                                 brilliantCount > 0 && 
                                 tusharPurseRemainingPercent > 50 &&
                                 !(player?.isIcon && tusharPurseRemainingPercent > 70) // Still bid on icons if high purse
  
  // Calculate estimated final price ONLY from actual data - NO MOCK VALUES
  // If no bids exist and no average bid, we cannot estimate - return 0 or undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const basePrice = (player?.data as any)?.['Base Price'] || (player?.data as any)?.['base price'] || 1000
  
  // Use stats-based predicted price as a baseline for recommendations
  const statsPredictedPrice = playerScore?.predictedPrice || basePrice * 5
  const statsMinPrice = playerScore?.minPrice || basePrice
  const statsMaxPrice = playerScore?.maxPrice || basePrice * 10
  
  let estimatedFinalPrice: number | null = null
  
  if (currentBid > 0) {
    // If there's a current bid, estimate based on likely bidders' probabilities and max bids
    const activeBidders = likelyBidders.filter(b => b.probability > 0.5)
    if (activeBidders.length > 0) {
      // Calculate average potential bid increase from active bidders
      const avgPotentialIncrease = activeBidders.reduce((sum, b) => {
        const potentialBid = Math.min(b.maxBid, currentBid * 3) // Cap at 3x current bid
        return sum + Math.max(0, potentialBid - currentBid)
      }, 0) / activeBidders.length
      estimatedFinalPrice = currentBid + Math.min(avgPotentialIncrease, minIncrement * 5) // Cap increase
    } else {
      // Fallback: use simple increment calculation
      estimatedFinalPrice = currentBid + (likelyBidders.length * minIncrement * 2)
    }
  } else if (averageBid > 0) {
    // If we have average bid data, use it
    estimatedFinalPrice = averageBid * 1.2
  } else {
    // No bids exist - use stats-based predicted price as estimate
    estimatedFinalPrice = statsPredictedPrice
  }
  
  // Ensure estimated price is reasonable (not exceed stats max by too much)
  if (estimatedFinalPrice && statsMaxPrice > 0) {
    estimatedFinalPrice = Math.min(estimatedFinalPrice, statsMaxPrice * 1.2)
  }
  
  // Factor in stats quality when making recommendations
  const hasStrongStats = playerScore && (
    playerScore.overallRating >= 60 || // Good overall rating
    (playerScore.breakdown?.battingScore || 0) >= 50 || // Good batting
    (playerScore.breakdown?.bowlingScore || 0) >= 50 || // Good bowling
    (playerScore.breakdown?.experienceScore || 0) >= 70 // Experienced
  )
  
  let action: 'bid' | 'pass' | 'wait' = 'wait'
  let recommendedBid: number | undefined = undefined
  let suggestedBuyPrice: number | undefined = undefined // Target price at which to buy
  let reasoning = ''
  let confidence = 0.5
  
  if (!canAfford) {
    action = 'pass'
    reasoning = `Insufficient balance. You have ₹${tusharBidder.remainingPurse.toLocaleString('en-IN')} but need at least ₹${(currentBid + minIncrement).toLocaleString('en-IN')} to bid.`
    confidence = 0.8
  } else if (competitionLevel === 'high' && estimatedFinalPrice !== null && estimatedFinalPrice > tusharBidder.remainingPurse * 0.4) {
    action = 'pass'
    reasoning = `High competition expected. Estimated final price (₹${estimatedFinalPrice.toLocaleString('en-IN')}) may exceed your budget comfort zone. Consider saving purse for other players.`
    confidence = 0.7
  } else if (tusharUtilization > 70 && estimatedFinalPrice !== null && tusharAvg > 0 && estimatedFinalPrice > tusharAvg * 1.5) {
    action = 'wait'
    reasoning = `You've already spent ${tusharUtilization.toFixed(0)}% of your purse. This player may go for ₹${estimatedFinalPrice.toLocaleString('en-IN')}, which is ${((estimatedFinalPrice / tusharAvg - 1) * 100).toFixed(0)}% above your average spend. Monitor closely.`
    confidence = 0.65
  } else if (shouldConsiderSaving && !(player?.isIcon) && !hasStrongStats && !tusharHasUrgentNeeds) {
    // If brilliant players are coming and Tushar has good purse, consider waiting
    // BUT if this player has strong stats OR Tushar has urgent needs (many slots to fill), still consider bidding
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brilliantNames = brilliantUpcomingPlayers?.slice(0, 3).map((p: any) => p.name).join(', ') || ''
    action = 'wait'
    suggestedBuyPrice = calculateSuggestedBuyPrice({
      statsPredictedPrice,
      statsMinPrice,
      statsMaxPrice,
      estimatedFinalPrice,
      mustSpendPerSlot: tusharMustSpendPerSlot,
      basePrice,
      urgency: 'LOW'
    })
    reasoning = `STRATEGIC CONSIDERATION: ${brilliantCount} brilliant player(s) coming up (${brilliantNames}${brilliantCount > 3 ? '...' : ''}). You have ${tusharPurseRemainingPercent.toFixed(0)}% purse remaining (₹${tusharBidder.remainingPurse.toLocaleString('en-IN')}). Consider saving for brilliant players unless this player fills a critical team gap. Competition is ${competitionLevel}.`
    confidence = 0.75
  } else if (hasStrongStats && estimatedFinalPrice !== null && estimatedFinalPrice <= statsMaxPrice && canAfford) {
    // Player has strong stats and price is within reasonable range - recommend bidding
    action = 'bid'
    suggestedBuyPrice = calculateSuggestedBuyPrice({
      statsPredictedPrice,
      statsMinPrice,
      statsMaxPrice,
      estimatedFinalPrice,
      mustSpendPerSlot: tusharMustSpendPerSlot,
      basePrice,
      urgency: urgencyLevel
    })
    // Recommended bid is the next increment from current bid (for immediate action)
    const targetBuyPrice = suggestedBuyPrice ?? roundToNearestThousand(Math.max(basePrice * 2, minIncrement))
    suggestedBuyPrice = targetBuyPrice
    const rawRecommendedBid = currentBid > 0 
      ? currentBid + minIncrement
      : Math.max(basePrice, targetBuyPrice * 0.6) // Start at 60% of buy price if no bids
    recommendedBid = roundToNearestThousand(rawRecommendedBid)
    let teamNeedsNote = ''
    if (tusharHasUrgentNeeds) {
      teamNeedsNote = ` URGENT TEAM NEED: You have ${tusharRemainingSlots} slots remaining and must spend ₹${Math.round(tusharMustSpendPerSlot).toLocaleString('en-IN')} per slot on average. This player fills a critical gap.`
    }
    const suggestedPriceDisplay = suggestedBuyPrice ? suggestedBuyPrice.toLocaleString('en-IN') : 'N/A'
    reasoning = `STRONG STATS PLAYER: This player has strong performance stats (Overall Rating: ${playerScore?.overallRating || 'N/A'}/100, Stats-Based Predicted Price: ₹${statsPredictedPrice.toLocaleString('en-IN')}).${teamNeedsNote} Suggested buy price: ₹${suggestedPriceDisplay} (within stats range: ₹${statsMinPrice.toLocaleString('en-IN')} - ₹${statsMaxPrice.toLocaleString('en-IN')}). Estimated final price: ₹${estimatedFinalPrice.toLocaleString('en-IN')}. Competition is ${competitionLevel}. Consider buying if price stays below ₹${suggestedPriceDisplay}.`
    confidence = 0.75
  } else if (canAfford && (competitionLevel !== 'high' || tusharHasUrgentNeeds)) {
    // Recommend bidding if can afford and (low competition OR urgent team needs)
    // If urgent needs, even high competition is acceptable (must form team)
    action = 'bid'
    const bidUrgency: UrgencyLevel = tusharHasUrgentNeeds ? 'HIGH' : urgencyLevel === 'LOW' ? 'MEDIUM' : urgencyLevel
    suggestedBuyPrice = calculateSuggestedBuyPrice({
      statsPredictedPrice,
      statsMinPrice,
      statsMaxPrice,
      estimatedFinalPrice,
      mustSpendPerSlot: tusharMustSpendPerSlot,
      basePrice,
      urgency: bidUrgency
    })
    // Recommended bid is the next increment from current bid
    const targetBuyPrice = suggestedBuyPrice ?? roundToNearestThousand(Math.max(basePrice * 2, minIncrement))
    suggestedBuyPrice = targetBuyPrice
    const rawRecommendedBid = currentBid > 0 
      ? currentBid + minIncrement
      : Math.max(basePrice, targetBuyPrice * 0.5) // Start at 50% of buy price if no bids
    recommendedBid = roundToNearestThousand(rawRecommendedBid)
    let strategicNote = ''
    if (hasBrilliantUpcoming && brilliantCount > 0 && !tusharHasUrgentNeeds) {
      strategicNote = ` Note: ${brilliantCount} brilliant player(s) coming up - balance your spending.`
    }
    let statsNote = ''
    if (playerScore) {
      statsNote = ` Stats-Based Price: ₹${statsPredictedPrice.toLocaleString('en-IN')} (Overall Rating: ${playerScore.overallRating}/100).`
    }
    let teamNeedsNote = ''
    if (tusharHasUrgentNeeds) {
      teamNeedsNote = ` URGENT: You have ${tusharRemainingSlots} slots remaining and must spend ₹${Math.round(tusharMustSpendPerSlot).toLocaleString('en-IN')} per slot. This player helps form your balanced team.`
    }
    const suggestedPriceDisplay = suggestedBuyPrice ? suggestedBuyPrice.toLocaleString('en-IN') : 'N/A'
    reasoning = `Good opportunity. Competition is ${competitionLevel}.${statsNote}${teamNeedsNote} Suggested buy price: ₹${suggestedPriceDisplay}. You have ${(100 - tusharUtilization).toFixed(0)}% of purse remaining (₹${tusharBidder.remainingPurse.toLocaleString('en-IN')}). Consider buying if price stays below ₹${suggestedPriceDisplay}.${strategicNote}`
    confidence = tusharHasUrgentNeeds ? 0.8 : 0.7 // Higher confidence when urgent needs
  } else {
    // Default to wait, BUT if Tushar has urgent needs and price is reasonable, recommend bid
    if (tusharHasUrgentNeeds && canAfford && estimatedFinalPrice !== null && estimatedFinalPrice <= tusharMustSpendPerSlot * 1.5) {
      // Urgent needs + reasonable price = recommend buying even if not perfect
      action = 'bid'
      suggestedBuyPrice = calculateSuggestedBuyPrice({
        statsPredictedPrice,
        statsMinPrice,
        statsMaxPrice,
        estimatedFinalPrice,
        mustSpendPerSlot: tusharMustSpendPerSlot,
        basePrice,
        urgency: 'HIGH'
      })
      const targetBuyPrice = suggestedBuyPrice ?? roundToNearestThousand(Math.max(basePrice * 2, minIncrement))
      suggestedBuyPrice = targetBuyPrice
      const rawRecommendedBid = currentBid > 0 
        ? currentBid + minIncrement
        : Math.max(basePrice, targetBuyPrice * 0.6)
      recommendedBid = roundToNearestThousand(rawRecommendedBid)
      const suggestedPriceDisplay = suggestedBuyPrice ? suggestedBuyPrice.toLocaleString('en-IN') : 'N/A'
      reasoning = `URGENT TEAM FORMATION NEED: You have ${tusharRemainingSlots} slots remaining and must spend ₹${Math.round(tusharMustSpendPerSlot).toLocaleString('en-IN')} per slot on average to form a balanced team. Estimated final price (₹${estimatedFinalPrice.toLocaleString('en-IN')}) is reasonable compared to your must-spend requirement. Suggested buy price: ₹${suggestedPriceDisplay}. You need to actively buy players to form your team - consider bidding if price stays below ₹${suggestedPriceDisplay}.`
      confidence = 0.75
    } else {
      action = 'wait'
      let strategicNote = ''
      if (hasBrilliantUpcoming && brilliantCount > 0 && !tusharHasUrgentNeeds) {
        strategicNote = ` ${brilliantCount} brilliant player(s) coming up - consider your strategy.`
      }
      let statsNote = ''
      if (playerScore) {
        statsNote = ` Stats analysis: Overall Rating ${playerScore.overallRating}/100, Stats-Based Price: ₹${statsPredictedPrice.toLocaleString('en-IN')} (range: ₹${statsMinPrice.toLocaleString('en-IN')} - ₹${statsMaxPrice.toLocaleString('en-IN')}).`
      } else {
        suggestedBuyPrice = calculateSuggestedBuyPrice({
          statsPredictedPrice,
          statsMinPrice,
          statsMaxPrice,
          estimatedFinalPrice,
          mustSpendPerSlot: tusharMustSpendPerSlot,
          basePrice,
          urgency: tusharHasUrgentNeeds ? 'MEDIUM' : 'LOW'
        })
        suggestedBuyPrice = suggestedBuyPrice ?? roundToNearestThousand(Math.max(basePrice * 2, minIncrement))
      }
      let teamNeedsNote = ''
      if (tusharHasUrgentNeeds) {
        teamNeedsNote = ` URGENT: You have ${tusharRemainingSlots} slots remaining - you need to actively buy players to form your team.`
      }
      if (estimatedFinalPrice === null) {
        const suggestedPriceDisplay = suggestedBuyPrice ? suggestedBuyPrice.toLocaleString('en-IN') : 'N/A'
        reasoning = `Monitor the bidding. ${likelyBidders.length} potential bidders identified. No bids placed yet - wait to see initial bids before deciding. Base price is ₹${basePrice.toLocaleString('en-IN')}.${statsNote}${teamNeedsNote}${strategicNote} Suggested buy price: ₹${suggestedPriceDisplay} - consider buying if price stays below this.`
      } else {
        const suggestedPriceDisplay = suggestedBuyPrice ? suggestedBuyPrice.toLocaleString('en-IN') : 'N/A'
        reasoning = `Monitor the bidding. ${likelyBidders.length} potential bidders identified. Wait to see initial bids before deciding.${statsNote}${teamNeedsNote}${strategicNote} Suggested buy price: ₹${suggestedPriceDisplay} - consider buying if price stays below this.`
      }
      confidence = 0.6
    }
  }
  
  if (!suggestedBuyPrice) {
    suggestedBuyPrice = calculateSuggestedBuyPrice({
      statsPredictedPrice,
      statsMinPrice,
      statsMaxPrice,
      estimatedFinalPrice,
      mustSpendPerSlot: tusharMustSpendPerSlot,
      basePrice,
      urgency: urgencyLevel
    }) ?? roundToNearestThousand(Math.max(basePrice * 2, minIncrement))
  }

  // CRITICAL: If current bid has exceeded suggested buy price, change action to PASS
  // This ensures recommendations stay relevant as bidding progresses
  // EXCEPTION: If urgent needs AND price is still reasonable relative to must spend per slot, allow it
  if (suggestedBuyPrice && currentBid > 0 && currentBid > suggestedBuyPrice) {
    const excessPercent = ((currentBid - suggestedBuyPrice) / suggestedBuyPrice * 100).toFixed(0)
    const excessAmount = currentBid - suggestedBuyPrice
    
    // Check if price is still reasonable for urgent needs (within 1.5x must spend per slot)
    const isReasonableForUrgentNeeds = tusharHasUrgentNeeds && 
                                       tusharMustSpendPerSlot > 0 && 
                                       currentBid <= tusharMustSpendPerSlot * 1.5
    
    // If current bid is significantly above suggested price (more than 10%), recommend PASS
    // UNLESS it's still reasonable for urgent team formation needs
    if (excessAmount > suggestedBuyPrice * 0.1 && !isReasonableForUrgentNeeds) {
      action = 'pass'
      let passReasoning = `PRICE EXCEEDED: Current bid (₹${currentBid.toLocaleString('en-IN')}) has exceeded your suggested buy price (₹${suggestedBuyPrice.toLocaleString('en-IN')}) by ₹${excessAmount.toLocaleString('en-IN')} (${excessPercent}% above target). `
      
      if (playerScore) {
        passReasoning += `While this player has strong stats (Overall Rating: ${playerScore.overallRating}/100, Stats-Based Predicted Price: ₹${statsPredictedPrice.toLocaleString('en-IN')}), the current price no longer represents good value. `
      }
      
      if (tusharHasUrgentNeeds) {
        passReasoning += `Even though you have ${tusharRemainingSlots} slots remaining, this price (₹${currentBid.toLocaleString('en-IN')}) exceeds your must-spend requirement (₹${Math.round(tusharMustSpendPerSlot).toLocaleString('en-IN')} per slot) by too much. `
      }
      
      passReasoning += `Consider passing and saving your budget for better opportunities.`
      
      reasoning = passReasoning
      confidence = 0.85 // High confidence when price exceeds target
      recommendedBid = undefined // No recommended bid if passing
    } else if (excessAmount > suggestedBuyPrice * 0.1 && isReasonableForUrgentNeeds) {
      // Price exceeded suggested buy price BUT still reasonable for urgent needs
      // Change to WAIT with strong warning, but don't completely pass
      action = 'wait'
      reasoning = `⚠️ PRICE WARNING: Current bid (₹${currentBid.toLocaleString('en-IN')}) exceeds your suggested buy price (₹${suggestedBuyPrice.toLocaleString('en-IN')}) by ₹${excessAmount.toLocaleString('en-IN')}. However, you have ${tusharRemainingSlots} slots remaining and must spend ₹${Math.round(tusharMustSpendPerSlot).toLocaleString('en-IN')} per slot. This price is still within your urgent team formation budget, but consider carefully before bidding further.`
      confidence = 0.65
      recommendedBid = undefined // Don't recommend bidding, just wait
    } else {
      // If only slightly above (within 10%), change to WAIT with warning
      if (action !== 'pass') {
        action = 'wait'
        reasoning = `⚠️ WARNING: Current bid (₹${currentBid.toLocaleString('en-IN')}) is approaching your suggested buy price (₹${suggestedBuyPrice.toLocaleString('en-IN')}). ${reasoning} Consider carefully before bidding further.`
        confidence = Math.max(0.5, confidence - 0.1)
      }
    }
  }
  
  const recommendedAction = {
    action,
    recommendedBid, // Next bid increment (for immediate action)
    suggestedBuyPrice, // Target price at which to buy (for strategic planning)
    reasoning,
    confidence
  }

  return {
    likelyBidders,
    recommendedAction,
    upcomingHighValuePlayers: brilliantUpcomingPlayers?.slice(0, 15).map((p: any) => {
      const statsScore = p.statsScore || (p.overallRating ? { overallRating: p.overallRating, breakdown: {} } : null)
      const predictedSpeciality = statsScore ? deriveSpecialityFromStats(statsScore) : (p.speciality || 'Unknown')
      const predictedStats = statsScore ? getPredictedStatsSummary(statsScore) : 'N/A'
      return {
        id: p.id,
        name: p.name,
        speciality: predictedSpeciality, // Use derived speciality
        predictedSpeciality: predictedSpeciality, // Add predicted speciality column
        predictedStats: predictedStats, // Add predicted stats column
        batting: p.batting,
        bowling: p.bowling,
        isIcon: p.isIcon,
        basePrice: p.basePrice,
        brillianceScore: p.brillianceScore,
        overallRating: p.overallRating || p.statsScore?.overallRating || 0,
        predictedPrice: p.predictedPrice || p.statsScore?.predictedPrice || 0,
        minPrice: p.statsScore?.minPrice || 0,
        maxPrice: p.statsScore?.maxPrice || 0,
        factors: p.factors || []
      }
    }) || [],
    marketAnalysis: {
      // Round to nearest 1000 (bids must be in multiples of 1000)
      averageBid: roundToNearestThousand(averageBid), // Average of all bids for this current player
      highestBid: roundToNearestThousand(highestBid), // Highest bid amount for this current player
      competitionLevel: likelyBidders.length > 2 ? 'high' : likelyBidders.length > 0 ? 'medium' : 'low',
      teamNeeds: (() => {
        // Deduplicate by bidderId - use a Map to ensure uniqueness
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teamNeedsMap = new Map<string, any>()
        
        bidders.forEach(b => {
          // Skip if we've already processed this bidder
          if (teamNeedsMap.has(b.id)) return
          
          // Find actual bidder to get remaining purse and purchased count
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const actualBidder = auctionBidders.find((ab: any) => ab.id === b.id)
          // Get team composition (which already has the players)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const composition = teamCompositions.find((t: any) => t.bidderId === b.id)
          const purchasedCount = composition?.players?.length || 0
          const targetTeamSize = 12 // Including bidder
          const remainingSlots = Math.max(0, targetTeamSize - (purchasedCount + 1))
          const remainingPurse = actualBidder?.remainingPurse || 0
          const mustSpendPerSlot = remainingSlots > 0 ? remainingPurse / remainingSlots : remainingPurse
          
          const players = composition?.players || []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const specialities = players.map((p: any) => p.speciality)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const battingTypes = players.map((p: any) => p.batting).filter(Boolean)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bowlingTypes = players.map((p: any) => p.bowling).filter(Boolean)
          
          // Count specific roles using derived specialities (from predicted stats)
          // Calculate stats-based speciality for each purchased player from teamCompositions
          const derivedSpecialities: string[] = []
          players.forEach((p: any) => {
            try {
              // Use the player data from teamCompositions (which has name, speciality, batting, bowling, price)
              // We need to reconstruct the player object for score calculation
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const playerForScoring = { data: p.data || { Name: p.name, Speciality: p.speciality || p.predictedSpeciality } }
              const purchasedPlayerScore = calculatePlayerScoreFromData(playerForScoring)
              const derived = deriveSpecialityFromStats(purchasedPlayerScore)
              derivedSpecialities.push(derived)
            } catch (error) {
              // Fallback to predicted speciality or original speciality if calculation fails
              derivedSpecialities.push(p.predictedSpeciality || p.speciality || 'Unknown')
            }
          })
          
          const batterCount = derivedSpecialities.filter((s: string) => 
            s.toLowerCase().includes('batter') || s.toLowerCase().includes('batsman')
          ).length
          const bowlerCount = derivedSpecialities.filter((s: string) => 
            s.toLowerCase().includes('bowler')
          ).length
          const allrounderCount = derivedSpecialities.filter((s: string) => 
            s.toLowerCase().includes('allrounder')
          ).length
          
          const needs: string[] = []
          let urgency = 5
          let reasoning = ''
          
          if (batterCount < 3) {
            needs.push(`Batters (${batterCount}/3)`)
            urgency += 2
            reasoning += `Needs ${3 - batterCount} more batter(s). `
          }
          if (bowlerCount < 3) {
            needs.push(`Bowlers (${bowlerCount}/3)`)
            urgency += 2
            reasoning += `Needs ${3 - bowlerCount} more bowler(s). `
          }
          if (allrounderCount < 1) {
            needs.push(`Allrounder (${allrounderCount}/1)`)
            urgency += 1
            reasoning += `Needs at least 1 allrounder. `
          }
          
          // Budget pressure analysis
          if (remainingPurse < 20000) {
            needs.push('Budget Constraint')
            urgency -= 1
            reasoning += `Low budget (₹${remainingPurse.toLocaleString('en-IN')} remaining). `
          } else if (mustSpendPerSlot > (totalPurse / targetTeamSize) * 1.5) {
            needs.push('High Budget Pressure')
            urgency += 1
            reasoning += `Must spend ₹${Math.round(mustSpendPerSlot).toLocaleString('en-IN')} per remaining slot (${remainingSlots} slots left). `
          }
          
          // Add team composition summary
          if (reasoning === '') {
            reasoning = 'Team is relatively balanced. '
          }
          reasoning += `Current: ${purchasedCount} players, ${remainingSlots} slots remaining. `
          reasoning += `Composition: ${batterCount} batters, ${bowlerCount} bowlers, ${allrounderCount} allrounders.`
          
          // Get team name from actual auction bidders first, then fallback to biddersContext
          const actualAuctionBidder = auctionBidders.find(ab => ab.id === b.id)
          const teamName = actualAuctionBidder?.teamName || 
                          actualAuctionBidder?.user?.name || 
                          actualAuctionBidder?.username ||
                          b.teamName || 
                          b.name || 
                          'Unknown Team'
          
          teamNeedsMap.set(b.id, {
            bidderId: b.id,
            teamName: teamName,
            needs: needs.length > 0 ? needs : ['Balanced Team'],
            urgency: Math.max(1, Math.min(10, urgency)),
            reasoning: reasoning,
            purchasedCount: purchasedCount,
            remainingSlots: remainingSlots,
            remainingPurse: remainingPurse,
            mustSpendPerSlot: Math.round(mustSpendPerSlot),
            composition: {
              batters: batterCount,
              bowlers: bowlerCount,
              allrounders: allrounderCount
            }
          })
        })
        
        // Convert map to array and sort by urgency
        return Array.from(teamNeedsMap.values()).sort((a, b) => b.urgency - a.urgency)
      })()
    }
  }
}

