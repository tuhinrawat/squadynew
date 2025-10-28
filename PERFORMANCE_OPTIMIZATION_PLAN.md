# Performance Optimization Plan - Squady Auction Platform

## Executive Summary
This document outlines a comprehensive performance optimization strategy to transform Squady into an A-grade, scalable real-time auction platform. The plan addresses database queries, API routes, real-time updates, component rendering, image optimization, and overall system performance.

---

## Current Architecture Analysis

### Strengths
✅ Prisma Accelerate integration for connection pooling  
✅ Real-time updates via Pusher  
✅ Server-side rendering with Next.js 14  
✅ Efficient proxy image handling  

### Critical Performance Bottlenecks Identified

1. **Database Query Issues**
   - Multiple sequential queries in bid API route
   - No query result caching
   - N+1 query problems in some routes
   - Full bid history stored in JSON field (query bottleneck)

2. **Real-time Performance**
   - Multiple Pusher subscriptions in single component
   - Missing connection pooling
   - No message batching

3. **Component Rendering**
   - Large components (AdminAuctionView ~1800 lines)
   - Unoptimized re-renders
   - Heavy calculations in render path

4. **Image Loading**
   - No preloading strategy
   - Synchronous image requests
   - Missing progressive loading

5. **API Route Optimization**
   - No response caching headers
   - Missing request rate limiting
   - Large payload sizes

---

## Optimization Strategy

### Phase 1: Database Optimization (Priority: Critical)

#### 1.1 Implement Database Indexing
**Files to modify:**
- `prisma/schema.prisma`

**Actions:**
```prisma
// Add indexes to improve query performance
model Auction {
  @@index([createdById])
  @@index([status])
  @@index([isPublished])
}

model Player {
  @@index([auctionId, status])
  @@index([auctionId, status, soldPrice])
}

model Bidder {
  @@index([auctionId])
  @@index([userId])
  @@index([auctionId, userId])
}

model Bid {
  @@index([auctionId, playerId, createdAt])
  @@index([bidderId, createdAt])
  @@index([playerId, createdAt])
}
```

#### 1.2 Optimize Bid API Route
**File: `src/app/api/auction/[id]/bid/route.ts`**

**Current Issues:**
- Sequential queries (auction → player → bidder)
- JSON field parsing on every request
- No caching

**Optimized Approach:**
```typescript
// Single query with all required data
const auction = await prisma.auction.findUnique({
  where: { id: params.id },
  select: {
    id: true,
    status: true,
    currentPlayerId: true,
    rules: true,
    bidHistory: true,
    players: {
      where: { id: auction.currentPlayerId },
      select: { id: true, status: true }
    },
    bidders: {
      where: { id: bidderId },
      include: { user: { select: { name: true } } }
    }
  }
})
```

#### 1.3 Add Response Caching
**Files:**
- `src/app/api/auctions/route.ts`
- `src/app/api/auctions/published/route.ts`

**Implementation:**
```typescript
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  // ... auth check ...
  
  const response = NextResponse.json({ auctions })
  
  // Add caching headers
  response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
  
  return response
}
```

---

### Phase 2: Component Optimization (Priority: High)

#### 2.1 Split AdminAuctionView Component
**File: `src/components/admin-auction-view.tsx` (1777 lines)**

**Split into smaller components:**
```
src/components/admin-auction-view/
├── index.tsx (main container)
├── header-section.tsx
├── stats-section.tsx
├── center-stage.tsx
├── bid-history-sidebar.tsx
├── bidders-grid.tsx
├── admin-controls.tsx
└── mobile-controls.tsx
```

#### 2.2 Implement React.memo for Heavy Components
**Files:**
- `src/components/teams-overview.tsx`
- `src/components/players-sold-table.tsx`
- `src/components/admin-auction-view.tsx`

```typescript
export const TeamsOverview = React.memo(function TeamsOverview({ auction }) {
  // ... component logic
})
```

#### 2.3 Optimize useCallback and useMemo Usage
**File: `src/components/admin-auction-view.tsx`**

**Actions:**
- Add missing dependencies to useCallback
- Use useMemo for expensive calculations
- Memoize filtered bid history

```typescript
const filteredBidHistory = useMemo(() => {
  return bidHistory.filter(bid => bid.playerId === currentPlayer?.id)
}, [bidHistory, currentPlayer?.id])

const currentBid = useMemo(() => {
  if (filteredBidHistory.length === 0) return null
  return filteredBidHistory[filteredBidHistory.length - 1]
}, [filteredBidHistory])
```

---

### Phase 3: Real-time Optimization (Priority: High)

#### 3.1 Optimize Pusher Hook
**File: `src/lib/pusher-client.ts`**

**Issues:**
- Multiple event listeners
- No cleanup optimization
- Potential memory leaks

**Solution:**
```typescript
export function usePusher(auctionId: string, options: UsePusherOptions = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const callbacksRef = useRef(options)
  
  // Update callbacks ref without re-subscribing
  useEffect(() => {
    callbacksRef.current = options
  }, [options])
  
  useEffect(() => {
    // ... subscription logic using callbacksRef.current
  }, [auctionId])
}
```

#### 3.2 Implement Message Batching
**For high-frequency events (bids), batch multiple events**

```typescript
const [batchedBids, setBatchedBids] = useState([])
const batchTimeoutRef = useRef(null)

useEffect(() => {
  // Create timer for batching
  batchTimeoutRef.current = setTimeout(() => {
    if (batchedBids.length > 0) {
      // Process all batched bids
      processBatch(batchedBids)
      setBatchedBids([])
    }
  }, 100) // 100ms batch window
  
  return () => clearTimeout(batchTimeoutRef.current)
}, [batchedBids])
```

---

### Phase 4: Image Optimization (Priority: Medium)

#### 4.1 Implement Image Preloading
**File: `src/components/admin-auction-view.tsx`**

```typescript
// Preload next player image
useEffect(() => {
  if (nextPlayer?.data?.profilePhotoLink) {
    const img = new Image()
    img.src = getProxyImageUrl(nextPlayer.data.profilePhotoLink)
  }
}, [nextPlayer])
```

#### 4.2 Add Progressive Image Loading
**Convert current img tags to use Next.js Image with blur placeholder**

```typescript
import Image from 'next/image'

// Current: <img src={proxyImageUrl} />
// Optimized:
<Image
  src={proxyImageUrl}
  alt={playerName}
  width={256}
  height={256}
  loading="lazy"
  placeholder="blur"
  blurDataURL="data:image/jpeg;base64,..."
/>
```

#### 4.3 Implement Image Compression
**File: `src/app/api/proxy-image/route.ts`**

Add sharp for image optimization:
```typescript
import sharp from 'sharp'

const imageBuffer = await response.arrayBuffer()
const optimizedBuffer = await sharp(Buffer.from(imageBuffer))
  .resize(512, 512, { fit: 'cover' })
  .webp({ quality: 85 })
  .toBuffer()

return new NextResponse(optimizedBuffer, {
  headers: {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
  },
})
```

---

### Phase 5: Next.js Configuration (Priority: Medium)

#### 5.1 Update next.config.js
**File: `next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode
  reactStrictMode: true,
  
  // Optimize images
  images: {
    domains: ['drive.google.com'],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
  },
  
  // Compression
  compress: true,
  
  // PoweredBy header removal
  poweredByHeader: false,
  
  // Optimize bundle
  swcMinify: true,
  
  // Production source maps
  productionBrowserSourceMaps: false,
  
  // HTTP compression
  compress: true,
};

module.exports = nextConfig;
```

#### 5.2 Add Response Compression
```bash
npm install compression
```

Create `next.config.js` middleware:
```javascript
const compression = require('compression')

// ... in next.config.js
async headers() {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=3600' },
      ],
    },
  ]
}
```

---

### Phase 6: State Management Optimization (Priority: Low)

#### 6.1 Implement Zustand Store (if needed)
**File: `src/lib/store/auction-store.ts`**

Create global state for auction data to prevent prop drilling and unnecessary re-renders:

```typescript
import { create } from 'zustand'

interface AuctionState {
  currentBid: BidState | null
  bidHistory: BidHistoryEntry[]
  setCurrentBid: (bid: BidState | null) => void
  addBidToHistory: (bid: BidHistoryEntry) => void
}

export const useAuctionStore = create<AuctionState>((set) => ({
  currentBid: null,
  bidHistory: [],
  setCurrentBid: (bid) => set({ currentBid: bid }),
  addBidToHistory: (bid) => set((state) => ({
    bidHistory: [...state.bidHistory, bid]
  })),
}))
```

---

### Phase 7: Bundle Optimization (Priority: Low)

#### 7.1 Analyze Bundle Size
```bash
npm install -D @next/bundle-analyzer
```

Update `next.config.js`:
```javascript
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

module.exports = withBundleAnalyzer(nextConfig)
```

Run analysis:
```bash
ANALYZE=true npm run build
```

#### 7.2 Code Splitting
**Split large components dynamically:**

```typescript
// Instead of direct import
import { TeamsOverview } from '@/components/teams-overview'

// Use dynamic import
const TeamsOverview = dynamic(() => import('@/components/teams-overview'), {
  loading: () => <Skeleton />,
  ssr: false, // Load client-side only
})
```

---

### Phase 8: API Route Optimization (Priority: High)

#### 8.1 Add Rate Limiting
**Install:**
```bash
npm install upstash/ratelimit upstash/redis
```

**Implementation:**
```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'), // 10 requests per 10 seconds
})

export async function POST(request: NextRequest, { params }) {
  const ip = request.ip ?? '127.0.0.1'
  const { success } = await ratelimit.limit(ip)
  
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  
  // ... rest of logic
}
```

#### 8.2 Optimize Payload Sizes
**Add data selection in queries:**

```typescript
// Only select needed fields
const auctions = await prisma.auction.findMany({
  where: { createdById: session.user.id },
  select: {
    id: true,
    name: true,
    status: true,
    createdAt: true,
    _count: {
      select: {
        players: true,
        bidders: true,
      }
    }
  },
  orderBy: { createdAt: 'desc' }
})
```

---

### Phase 9: Caching Strategy (Priority: Critical)

#### 9.1 Implement Redis Cache
**Install:**
```bash
npm install @upstash/redis
```

**Create cache utility:**
`src/lib/cache.ts`
```typescript
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 60
): Promise<T> {
  const cached = await redis.get<T>(key)
  if (cached) return cached
  
  const data = await fetcher()
  await redis.setex(key, ttl, data)
  return data
}
```

**Usage in API routes:**
```typescript
const auctions = await getCached(
  `auctions:${session.user.id}`,
  () => prisma.auction.findMany({ ... }),
  60 // 60 seconds cache
)
```

#### 9.2 Implement Revalidation
**Add on-demand revalidation:**

```typescript
// In bid API after successful bid
await fetch(`/api/revalidate?path=/auction/${params.id}`, {
  method: 'POST',
})
```

---

### Phase 10: Monitoring & Metrics (Priority: Low)

#### 10.1 Add Performance Monitoring
**Install Vercel Speed Insights:**
```bash
npm install @vercel/speed-insights
```

**Add to layout:**
```typescript
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Analytics } from '@vercel/analytics/react'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  )
}
```

#### 10.2 Add Database Query Monitoring
**Track slow queries:**
```typescript
// In prisma.ts
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
  ],
})

prisma.$on('query', (e) => {
  if (e.duration > 100) {
    console.warn('Slow query detected:', e.query, e.duration)
  }
})
```

---

## Implementation Priority Matrix

### Immediate (Week 1)
1. ✅ Database indexing (Phase 1.1)
2. ✅ API response caching headers (Phase 1.3)
3. ✅ Next.js configuration updates (Phase 5)
4. ✅ Add rate limiting to bid API (Phase 8.1)

### Short-term (Week 2-3)
5. ✅ Optimize bid API route queries (Phase 1.2)
6. ✅ Implement Redis caching (Phase 9.1)
7. ✅ Image optimization with sharp (Phase 4.3)
8. ✅ Component code splitting (Phase 2.1)

### Medium-term (Week 4-5)
9. ✅ React.memo optimization (Phase 2.2)
10. ✅ Bundle size analysis (Phase 7.1)
11. ✅ Pusher connection pooling (Phase 3.1)
12. ✅ Progressive image loading (Phase 4.2)

### Long-term (Week 6+)
13. ✅ State management refactor (Phase 6)
14. ✅ Performance monitoring (Phase 10)
15. ✅ Advanced caching strategies

---

## Expected Performance Improvements

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| API Response Time | 200-300ms | 50-100ms | 70% |
| Database Queries | 5-7 per request | 1-2 per request | 80% |
| Component Render Time | 100-150ms | 30-50ms | 70% |
| Image Load Time | 2-3s | 0.5-1s | 75% |
| Bundle Size | ~2MB | ~800KB | 60% |
| Real-time Latency | 100-200ms | 30-50ms | 75% |

---

## Success Criteria

✅ All linter errors resolved  
✅ Lighthouse score > 90 across all categories  
✅ API response time < 100ms (P95)  
✅ Database queries < 50ms average  
✅ Zero N+1 query problems  
✅ Bundle size < 1MB  
✅ Real-time updates < 50ms latency  
✅ No memory leaks  
✅ 100% uptime during load testing  

---

## Risk Mitigation

1. **Backup Strategy**: All changes deployed to staging first
2. **Rollback Plan**: Feature flags for new optimizations
3. **Testing**: Comprehensive E2E tests before production
4. **Monitoring**: Real-time alerts on performance metrics
5. **Gradual Rollout**: Feature flags enable gradual rollout

---

## Next Steps

1. Review and approve this optimization plan
2. Prioritize phases based on business needs
3. Create feature branch for optimizations
4. Begin Phase 1 implementation
5. Set up monitoring and alerts
6. Run load tests after each phase
7. Deploy incrementally with feature flags

---

*Generated: ${new Date().toISOString()}*  
*Estimated Implementation Time: 6-8 weeks*  
*Developer Resources Required: 1-2 full-time*

