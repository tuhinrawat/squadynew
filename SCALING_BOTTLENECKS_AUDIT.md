# Squady — Scaling Bottlenecks & Anti-Patterns Audit

Stack: Next.js 14 (App Router) · Prisma 6 + Accelerate · PostgreSQL · Pusher Channels · NextAuth · Vercel (`sin1`, single region).

App shape: live cricket-auction. One admin/presenter drives; many anonymous viewers watch. Realtime = Pusher for presenter/admin, **6s polling of `/snapshot` for public viewers**.

---

## Severity summary

| # | Issue | Severity | Scales badly with |
|---|-------|----------|-------------------|
| 1 | `bidHistory` stored as one JSONB blob on the `Auction` row | 🔴 Critical | bids per lot × lots |
| 2 | Bid write = read-modify-write, no transaction, no lock | 🔴 Critical | concurrent bidders |
| 3 | Pusher broadcast fires *before* DB commit | 🔴 Critical | correctness under load |
| 4 | `track-view` increments the same hot `auctions` row per viewer | 🟠 High | concurrent viewers |
| 5 | Every Pusher trigger writes an `ObservabilityEvent` row | 🟠 High | bids × server activity |
| 6 | In-memory rate limiter on serverless | 🟠 High | function instances |
| 7 | Single region `sin1` + many sequential awaits per request | 🟠 High | DB round-trips |
| 8 | Accelerate wired but no `cacheStrategy` on any read | 🟡 Medium | read volume |
| 9 | `/public` route: full player blobs + write inside GET | 🟡 Medium | viewers hitting it |
| 10 | Sequential-write loops (`reset`, `duplicate`) | 🟡 Medium | roster size |
| 11 | `predict` (OpenAI) no `maxDuration`, loads all blobs | 🟡 Medium | roster size |
| 12 | Debug/backfill mutation routes shipped in prod | 🟡 Medium | security |
| 13 | `AuctionView` / `ObservabilityEvent` tables unbounded | 🟢 Low | time |

---

## 🔴 1–3: The bid write model (root cause of "concurrent bidding breaks")

### The data model
`bidHistory Json?` on `Auction` ([prisma/schema.prisma:79](prisma/schema.prisma)) holds **every bid + sold/unsold event for every player in the whole auction** as one JSON array on a single row.

### What every bid does — [bid/route.ts](src/app/api/auction/[id]/bid/route.ts)
1. `findUnique(auction)` → read the entire `bidHistory` array
2. `bidHistory.unshift(newBid)` in JS
3. `prisma.auction.update({ bidHistory })` → rewrite the **entire** array back

Problems this creates:

- **Write amplification O(n):** every bid rewrites the full array. Late in a busy auction the blob is large; each new bid re-serializes and rewrites all of it. Cost per bid grows with the auction.
- **Lost updates (race):** no `$transaction`, no row lock, no optimistic version check. Two bids landing together both read version N, both unshift, both write — the second clobbers the first. `grep -r '$transaction'` shows the **bid route has none** (mark-sold/mark-unsold were later wrapped, bid was not). This is the concrete reason a real bidding war produces wrong/missing bids.
- **Row contention:** 13 routes write this same `Auction` row. All live mutations serialize on one row.
- **Broadcast-before-commit** ([bid/route.ts](src/app/api/auction/[id]/bid/route.ts), also mark-sold): `triggerAuctionEvent('new-bid')` fires, *then* `await update`. If the write loses the race or fails, viewers already saw a bid that isn't in the DB. Under load the UI and DB diverge.

### Fix — make bids rows, not a blob
```prisma
model Bid {
  id        String   @id @default(cuid())
  auctionId String
  playerId  String
  bidderId  String
  amount    Float
  type      String   @default("bid") // bid | sold | unsold
  createdAt DateTime @default(now())

  auction Auction @relation(fields: [auctionId], references: [id], onDelete: Cascade)
  player  Player  @relation(fields: [playerId], references: [id])
  bidder  Bidder  @relation(fields: [bidderId], references: [id])

  @@index([auctionId, playerId, createdAt])
  @@index([auctionId, playerId, amount])
}
```
- Place bid = one `INSERT`. No read-modify-write, no lost updates — Postgres serializes inserts safely.
- Current highest for a lot = `ORDER BY amount DESC LIMIT 1`, index-backed.
- Wrap the "validate highest + insert" in a `$transaction` with `SELECT ... FOR UPDATE` on the player row (or an optimistic check) to make "is this still the top bid" atomic.
- Broadcast **after** commit.

`bidHistory` JSONB can be kept temporarily as a denormalized cache, but it must stop being the source of truth for concurrent writes.

---

## 🟠 4: `track-view` writes the hot auction row on every viewer
[track-view/route.ts](src/app/api/auction/[id]/track-view/route.ts) does, per viewer mount:
`findFirst(view)` → `auctionView.create` → `auction.update({ totalViews: { increment } })`.

The `increment` targets the **same `auctions` row** that the bid/sale path is writing. Every viewer contends for that row lock against live bidding. At hundreds of concurrent viewers this serializes writes and adds latency to bids.

Fix: move view counters off the auction row. Insert-only into `AuctionView` and compute counts with `count()` / a materialized aggregate, or increment a separate `auction_stats` row, or batch via a periodic job. Never write analytics counters to the same row as live-auction state.

---

## 🟠 5: Observability write on every Pusher trigger
`triggerAuctionEvent` → `logEventAsync` → `prisma.observabilityEvent.create` ([pusher.ts](src/lib/pusher.ts), [observability.ts](src/lib/observability.ts)). It's `waitUntil` (off the response path — good) but it's still **a DB write for every bid, sale, and rejected bid**, on the same Postgres. During a busy auction this roughly doubles write volume and grows `observability_events` fast.

Fix: sample these like the snapshot route already samples its size log (e.g. keep all failures, sample 10–20% of successes), or ship telemetry to a store that isn't your primary Postgres (Vercel logs / Axiom / Logflare).

---

## 🟠 6: In-memory rate limiter on serverless
[rate-limiter.ts](src/lib/rate-limiter.ts) keeps state in a per-process `Map` (the file's own comment admits it). On Vercel each function instance has its own empty map, so the bid limit is bypassable by fanning requests across instances, and is inconsistent under load. Move to Upstash Redis / Vercel KV (`INCR` + TTL) — the code is already structured so only `check()` internals change.

---

## 🟠 7: Single region + sequential awaits
`vercel.json` pins `sin1`. The bid route issues ~4+ **sequential** `await prisma.*` calls; each pays a full round-trip. If Postgres/Accelerate isn't co-located in/near Singapore, every request multiplies cross-region latency.
- Confirm the DB region == `sin1`.
- Collapse independent queries with `Promise.all` (partly done) and push validation into a single transaction/query where possible.

---

## 🟡 8: Prisma Accelerate paid for, not used for caching
`withAccelerate()` is wired ([prisma.ts](src/lib/prisma.ts)) but **no query sets `cacheStrategy`**. You get connection pooling but zero read caching. Add `cacheStrategy: { ttl, swr }` to hot read paths (published lists, static-ish auction metadata). Reads that must be fresh (live bid state) stay uncached.

---

## 🟡 9: `/public` route
[public/route.ts](src/app/api/auctions/[id]/public/route.ts): `players: true` loads every player's full `data` JSON blob + all bidders, and computes stats in JS by scanning arrays. Worse, a **GET performs a write** (`auction.update({ currentPlayerId: null })`) — non-idempotent and un-cacheable.

Note: the primary public path (`/snapshot`) is already well-optimized (trimmed `select`, `players` reduced to `{id,status,isIcon}`, edge cache `s-maxage=2`, sampled logging). Bring `/public` up to the same standard or route callers to `/snapshot`. Move the currentPlayerId cleanup into the write routes.

---

## 🟡 10: Sequential-write loops
- [reset/route.ts:54](src/app/api/auction/[id]/reset/route.ts) — resets each bidder's purse in a `for` loop, one `update` per bidder (N sequential round-trips). Use a single transaction, or raw SQL `UPDATE bidders SET "remainingPurse" = "purseAmount" WHERE ...`.
- [duplicate/route.ts:55](src/app/api/auctions/[id]/duplicate/route.ts) — creates players/bidders one-by-one. Use `createMany` (or a batched transaction).

Both are admin-rare, so lower priority, but they time out on large rosters.

---

## 🟡 11: `predict` (OpenAI) route
[predict/route.ts](src/app/api/analytics/[id]/predict/route.ts) — 2069 lines, calls `openai.chat.completions.create`, loads `players: true` (all blobs), and sets **no `maxDuration`**. OpenAI latency can exceed the default function timeout → hard failures. Set `export const maxDuration`, stream or background the LLM call, and hoist `require('openai')` to a module import.

---

## 🟡 12: Debug mutation routes in production
`src/app/api/debug/*` includes backfill/fix/clean endpoints ([backfill-sales](src/app/api/debug/backfill-sales/route.ts), [clean-and-backfill-from-xlsx](src/app/api/debug/clean-and-backfill-from-xlsx/route.ts), [fix-bidder-images](src/app/api/debug/fix-bidder-images/route.ts), …). These are reachable in prod and perform heavy writes. Gate behind an env flag / super-admin auth, or strip from the deployed build.

---

## 🟢 13: Unbounded tables
`AuctionView` (one row per view) and `ObservabilityEvent` (see #5) grow without bound. There's a cleanup route ([observability/cleanup](src/app/api/observability/cleanup/route.ts)) — make sure it's scheduled (Vercel Cron) and add retention for `AuctionView`.

---

## Recommended order of work
1. **`Bid` table + transactional insert** — fixes #1, #2, #3 together. Refactor `bid`, `mark-sold`, `mark-unsold`, `undo-bid`, `undo-sale` to read/write rows. Broadcast after commit.
2. **Move view counters + observability writes off the hot path/row** (#4, #5) — sampling + separate counter row/store.
3. **Redis rate limiter** (#6).
4. **Verify DB region == `sin1`; add `cacheStrategy` to read paths** (#7, #8).
5. Cleanup: `/public` parity, batch the loops, `maxDuration` on `predict`, gate debug routes (#9–#12).

## What's already good (don't touch)
- `/snapshot` payload trimming + edge caching + sampled telemetry.
- `mark-sold` / `mark-unsold` transactions with race-guarded `updateMany(status: 'AVAILABLE')`.
- Pusher hiccups no longer turn committed writes into 500s.
- Schema indexes are comprehensive (24 `@@index`/`@@unique`).
- Published-list route caches (`s-maxage=300`) and uses `_count` instead of loading rows.
