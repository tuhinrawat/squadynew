# Bidder Analytics Page

## Overview
A hidden analytics page that provides intelligent bidding insights for Tushar's bidder account.

## Access
The page is only accessible with a special key: `tushkiKILLS`

**URL Format:**
```
/analytics/[auctionId]?key=tushkiKILLS
```

Example:
```
/analytics/cmhnko8z0004h1ifixpqpjnzz?key=tushkiKILLS
```

## Features

### 1. Current Player Display
- Shows the player currently in auction
- Displays player card with all relevant information

### 2. Player Table Tab
- Lists all players in the auction
- Shows latest status (AVAILABLE, SOLD, UNSOLD)
- Customizable columns - you can show/hide any column from player data
- Search functionality to filter players
- Displays all custom columns from player data

### 3. Bid Analytics Tab
AI-powered analytics with three main sections:

#### a) AI-Powered Recommendation
- Action recommendation: BID, PASS, or WAIT
- Suggested bid amount (if bidding)
- Confidence percentage
- Detailed reasoning

#### b) Likely Bidders
- Probability of each bidder placing a bid
- Maximum bid estimate for each bidder
- Reasoning for each prediction

#### c) Market Analysis
- Average bid amount
- Highest bid amount
- Competition level (low/medium/high)
- Team needs analysis with urgency scores

## Setup

### 1. OpenAI API Key (Optional but Recommended)
For AI-powered predictions, add your OpenAI API key to `.env.local`:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

**Note:** The page will work without OpenAI API key, but will use basic fallback predictions instead of AI-powered insights.

### 2. Finding Tushar's Bidder
The page automatically finds Tushar's bidder record by searching for:
- User name containing "tushar"
- Username containing "tushar"
- Team name containing "tushar"

## How It Works

### AI Analysis
When OpenAI API key is provided, the system:
1. Analyzes current player's attributes (speciality, batting, bowling, custom data)
2. Reviews all bidders' remaining purse balances
3. Examines team compositions (players already purchased)
4. Studies bidding history patterns
5. Predicts which bidders are likely to bid
6. Recommends actions for Tushar based on:
   - His remaining balance
   - Team needs
   - Competition level
   - Market trends

### Fallback Mode
Without OpenAI API key, the system uses basic logic:
- Calculates probabilities based on remaining purse
- Estimates max bids as 30% of remaining balance
- Provides simple recommendations

## Technical Details

### Files Created
- `/src/app/analytics/[id]/page.tsx` - Main page route
- `/src/components/analytics-view.tsx` - Main view component
- `/src/components/analytics/player-table.tsx` - Player table component
- `/src/components/analytics/bid-analytics.tsx` - Analytics display component
- `/src/app/api/analytics/[id]/predict/route.ts` - API endpoint for predictions
- `/src/components/ui/tabs.tsx` - Tabs UI component

### Dependencies Added
- `openai` - OpenAI SDK for AI predictions
- `@radix-ui/react-tabs` - Tabs component

## Usage Tips

1. **Access the page** with the special key in the URL
2. **View current player** at the top of the page
3. **Switch between tabs** to see player table or analytics
4. **Customize columns** in Player Table to see relevant data
5. **Refresh analytics** to get updated predictions
6. **Monitor recommendations** to make informed bidding decisions

## Security

- The page is hidden from navigation
- Only accessible with the special key `tushkiKILLS`
- No authentication required (key-based access)
- Should be kept secret

