# Redis Caching Layer

Cache-aside over Postgres. **Postgres is always the source of truth for writes; reads are served from Redis the majority of the time.** Redis being down never breaks the app — every read falls through to Postgres.

## Files
- [src/lib/redis.ts](src/lib/redis.ts) — Upstash REST client (right client for Vercel serverless). Safe wrappers: `redisGetJSON`, `redisSetJSON`, `redisDel`. All swallow errors → "cache unavailable, use Postgres". Returns `null` client when env vars absent (local dev without Redis still works).
- [src/lib/cache.ts](src/lib/cache.ts) — `cacheGetOrSet(key, ttl, fetcher)` + entity helpers and their invalidators.

## Env vars (required for caching; absent = falls back to Postgres)
Add to `.env.local` and Vercel project env:
```
UPSTASH_REDIS_REST_URL="https://<your-db>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<rotate the one you pasted — it's compromised>"
```
⚠️ The token pasted in chat is now in the transcript. **Rotate it in the Upstash console** and use the new one here.

## What is cached (small data, read far more than written)

| Helper | Key | Data | TTL backstop | Invalidated by |
|--------|-----|------|--------------|----------------|
| `getCachedPlayerStatuses` | `auction:players:status:{id}` | `{id,status,isIcon}[]` | 60s | every player-status write |
| `getCachedBidderPurses` | `auction:bidders:{id}` | `{id,remainingPurse}[]` | 120s | every purse/roster write |
| `getCachedAuctionMetaById` / `BySlug` | `auction:meta:{id}`, `auction:slug:{slug}` | static auction fields | 300s | auction edit / publish / delete |

**Not cached (deliberately):** current highest bid, `bidHistory`, `currentPlayerId`, view counters — they change on every bid and are already collapsed by the `/snapshot` route's 2s edge cache. Caching them would only add staleness.

## Where it's wired now
`/api/auction/[id]/snapshot` — the hottest path (every public viewer polls it every 6s). Its two per-poll roster scans (`player.findMany` + `bidder.findMany`) now read from Redis. On a steady poll the vast majority of these are Redis hits instead of Postgres row scans. Payload and behaviour are unchanged (same shapes).

## Invalidation map (write-through — cleared right after the Postgres commit)
- **players:** mark-sold, mark-unsold, next-player, undo-sale, reset, reconcile-offline, register, players/clear, players/upload, players/[playerId] (PUT+DELETE), batch-update
- **bidders:** mark-sold, undo-sale, reset, reconcile-offline, bidders POST, bidders/[bidderId] (PUT+DELETE), batch-update
- **meta:** auction PUT (old + new slug), publish, delete

TTL is only the backstop for a missed invalidation — explicit invalidation is the fast path, so viewers stay within one poll of the DB.

## How to add a new cached read
```ts
import { cacheGetOrSet } from '@/lib/cache'
const data = await cacheGetOrSet('my:key', 60, () => prisma.something.findMany(...))
```
Then call the matching `redisDel('my:key')` (wrap it in an `invalidateX` helper in cache.ts) from every route that writes that data, **after** the Postgres write commits.

## Caveat for extending the meta cache
`getCachedAuctionMeta*` helpers exist but aren't wired into a reader yet. `scheduledStartDate` is a `Date`; JSON round-trips it to a **string** through Redis. Any reader that adopts the meta cache must re-parse it (`new Date(meta.scheduledStartDate)`). The active caches (players/bidders) have no Date fields, so they're unaffected.

## Viewer / view tracking moved to Redis ([src/lib/view-tracking.ts](src/lib/view-tracking.ts))
`totalViews`, `uniqueVisitors`, `timerViews`, `peakViewers` and the live viewer count were all written onto the **same `auctions` row that live bidding writes**, so every viewer's page-view took a write lock on the hot auction row and serialized against bids. Live viewer count was also kept in a per-process in-memory Map — fragmented and wrong across Vercel instances.

Now:
- Counters live in Redis (atomic `INCR`/`DECR`, no hot-row lock). **Seeded from the current Postgres values on first touch**, so numbers continue from today's totals, they do not reset.
- Flushed back to Postgres (`flushViewStats`) on ~5% of writes and available for a cron, so the dashboard/tables/analytics keep reading `auction.totalViews` etc. exactly as before.
- Uniqueness is still decided by the durable `AuctionView` rows — semantics unchanged.
- Live viewer count is now correct across all instances (same join/leave/get API and `{count}` shape).
- **Redis down → every one of these routes falls back to the original Postgres path.** No behaviour change either way.

Routes wired: `track-view`, `track-timer-view`, `viewers` (all with Postgres/in-memory fallback preserved).

## `Bid` table + atomic bid write (fixes the lost-update race)
- New `Bid` model + migration [prisma/migrations/20260913120000_add_bids_table](prisma/migrations/20260913120000_add_bids_table/migration.sql) (applied by the build's `prisma migrate deploy`). FK cascade from auction/player/bidder so existing delete routes don't break.
- The bid write in [bid/route.ts](src/app/api/auction/[id]/bid/route.ts) now runs inside a `$transaction` that locks the auction row (`SELECT ... FOR UPDATE`), re-derives the current highest bid from the locked history, re-checks the two race-sensitive rules (min increment + "already highest") with the **same messages**, writes `bidHistory`, and inserts a `Bid` row — all atomically. Concurrent bids serialize instead of clobbering each other.
- **`bidHistory` JSON stays the source of truth for every reader** (all ~30 read sites untouched). The `Bid` table is a durable, indexed dual-write, not yet read — a later migration can move reads onto it.

### One deliberate behaviour change (flagged)
The `new-bid` Pusher broadcast now fires **after** the DB commit instead of before it. Same event name and payload. Effect: viewers only ever see bids that actually persisted — a rejected/raced attempt no longer briefly flashes on screen. Cost: a bid appears ~one DB-write later. This is the correctness fix that makes concurrent bidding safe; everything else preserves existing logic exactly.

## Rate limiter (next step, not yet done)
`@upstash/ratelimit` is installed. Replace the in-memory `RateLimiter` in [src/lib/rate-limiter.ts](src/lib/rate-limiter.ts) with an Upstash-backed limiter so the bid limit works across serverless instances.
