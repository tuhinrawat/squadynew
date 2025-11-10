# Critical Bug: Undo Sale Doesn't Clear Bid History

## Problem

When a player is marked as SOLD and then the sale is UNDONE:
1. ✅ Player status → AVAILABLE
2. ✅ soldPrice → null
3. ✅ soldTo → null
4. ✅ currentPlayerId → this player
5. ❌ **Bid history still contains all old bids for this player**

## Impact

When you try to place a new bid after undo sale:
- The API filters bid history by playerId
- Finds the last bid (e.g., ₹6,000)
- Expects new bid to be > ₹6,000
- **Should start fresh from base price!**

## Solution

When undoing a sale, we need to **remove all bids for that player** from the bid history.

### Option 1: Delete bid history for that player (Recommended)
```typescript
// Remove all bids for this player from bid history
const updatedBidHistory = bidHistory.filter((bid: any) => 
  bid.playerId !== lastSoldPlayer.id
)
```

### Option 2: Mark bids as "undone" (keeps history for audit)
```typescript
// Mark all bids for this player as undone
const updatedBidHistory = bidHistory.map((bid: any) => 
  bid.playerId === lastSoldPlayer.id 
    ? { ...bid, type: 'bid-undone-due-to-sale-undo' }
    : bid
)
```

## Files to Fix
1. `src/app/api/auction/[id]/undo-sale/route.ts` - Clear bid history
2. `src/app/api/auction/[id]/undo-bid/route.ts` - Add visible undo entry instead of removing

