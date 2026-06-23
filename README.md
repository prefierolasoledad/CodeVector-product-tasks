# Product Catalog — Cursor-Based Pagination API

A high-performance REST API serving 200,000 products with **cursor-based (keyset) pagination**, built to demonstrate how to paginate large datasets without duplicates or skipped items — even when new data is inserted mid-pagination.

## Tech Stack

- **Backend:** Node.js, Express 5
- **Database:** MongoDB (Mongoose ODM)
- **Hosting:** [LIVE URL] (Render) / MongoDB Atlas
- **UI:** Single static HTML/CSS/JS page (no framework)

## Setup Instructions

### 1. Clone & install

```bash
git clone [REPO URL]
cd CodeVector-product-tasks
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```env
MONGO_URI=mongodb://localhost:27017/codevector   # or your Atlas connection string
PORT=5000
```

### 3. Seed the database (200,000 products)

```bash
npm run seed
```

This inserts 200k products in batched `insertMany()` calls (~40 batches of 5,000). It drops the collection first, so it's safe to re-run. You'll see per-batch progress and a final count + index verification.

### 4. Start the server

```bash
npm run dev       # development (nodemon hot-reload)
npm start         # production
```

The UI is served at `http://localhost:5000` and the API is available at the same origin.

---

## API Documentation

### `GET /products`

Paginated product listing, sorted newest-first.

| Param      | Type   | Default | Description                                      |
|------------|--------|---------|--------------------------------------------------|
| `limit`    | number | 20      | Page size (1–100)                                |
| `category` | string | —       | Optional category filter (exact match)           |
| `cursor`   | string | —       | Opaque cursor from a previous response's `nextCursor` |

**Response:**

```json
{
  "data": [
    {
      "_id": "6a3a79b65dfb2ccc3c311869",
      "name": "Vintage Charger",
      "category": "Electronics",
      "price": 782.04,
      "createdAt": "2026-06-23T12:13:33.766Z",
      "updatedAt": "2026-06-23T12:13:33.766Z"
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTIzVDEyOjAzOjAyLjYwM1oiLCJfaWQiOiI2YTNhNzliNjVkZmIyY2NjM2MzMTE4NjQifQ"
}
```

- `nextCursor` is `null` when there are no more results (last page).
- The cursor is a Base64url-encoded JSON containing `{ createdAt, _id }` — clients should treat it as opaque.

### `GET /categories`

Returns all distinct product categories (for populating a filter dropdown).

**Response:**

```json
{
  "data": ["Automotive", "Beauty", "Books", "Clothing", "Electronics", "..."]
}
```

---

## Design Decisions

### Why cursor/keyset pagination instead of `skip()`/offset

**The problem with offset pagination:**
- `skip(N)` must walk through N documents on every call — it's O(n) and gets slower linearly with page depth. At 190k depth on this dataset, `skip()` takes ~238ms vs ~3ms for cursor pagination (**~80× slower**).
- When new data is inserted while a user is paginating, offset-based pages shift: items get duplicated or skipped entirely. There's no way to fix this without locking or snapshots.

**How cursor pagination solves both:**
- The cursor encodes the last seen `(createdAt, _id)` pair. The next page query uses a `$lt` range condition to fetch only items *after* that position in the sort order. MongoDB seeks directly to that position via the index — O(log n), examining only `limit` documents regardless of depth.
- A new product inserted at the top has a `createdAt` greater than everything already fetched, so it will never appear in a `$lt` range query for a cursor a user already holds — **no duplicates, no skips** for pages already turned. It correctly shows up if the user restarts from page 1.
- An update to an existing, already-passed product doesn't change its `createdAt`, so it doesn't move and doesn't get duplicated either.

### Why sorting on `(createdAt, _id)` and not `updatedAt`

- `updatedAt` changes on every mutation. If we sorted by `updatedAt`, editing a product would move it to the top of the list, causing it to re-appear on page 1 for someone who already saw it — a duplicate.
- `createdAt` is immutable after insert, so a product's position in the sort order never changes after creation.
- `_id` (ObjectId) is monotonically increasing and globally unique, so it serves as a perfect tiebreaker when multiple products share the same `createdAt` millisecond. At 200k inserts, many documents *do* collide on the same millisecond — this was validated with a dedicated test (100 documents with identical `createdAt`, paginated with limit=7 across 15 pages: zero duplicates, zero skips).

### Indexes

| Index | Purpose |
|-------|---------|
| `{ createdAt: -1, _id: -1 }` | Full-collection "newest first" cursor pagination. Mongo walks the index in order — no in-memory sort. |
| `{ category: 1, createdAt: -1, _id: -1 }` | Category-filtered pagination. The equality prefix (`category`) narrows the scan, then the sort suffix (`createdAt`, `_id`) is already in index order — **single IXSCAN, no in-memory sort**. |

Both indexes were verified with `.explain("executionStats")`:
- Stage: **IXSCAN** (not COLLSCAN)
- Docs examined = docs returned (20 examined for 20 returned, even 100k documents deep)

### Explicit `createdAt`/`updatedAt` vs `timestamps: true`

The schema defines `createdAt` and `updatedAt` as explicit `Date` fields instead of using Mongoose's `timestamps: true`. This gives the seed script full control over `createdAt` to spread products across a realistic 2-year historical range (so "newest first" actually means something). A `pre('save')` hook auto-manages `updatedAt` for normal app writes, while `insertMany()` (used by the seed script) bypasses save hooks by design.

For a deeper technical walkthrough of the architecture, cursor mechanics, and request lifecycle, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Project Structure

```
├── public/
│   └── index.html              # Static UI (table, category filter, Load More)
├── src/
│   ├── config/
│   │   └── db.js               # Mongoose connection
│   ├── models/
│   │   └── Product.js          # Schema, indexes, pre-save hook
│   ├── routes/
│   │   ├── productRoutes.js    # GET /products (cursor pagination)
│   │   └── categoryRoutes.js   # GET /categories
│   └── scripts/
│       ├── seed.js             # Insert 200k products (batched)
│       ├── validatePagination.js   # Correctness tests
│       ├── perfValidation.js       # explain() + cursor vs skip() benchmark
│       └── testPagination.js       # Quick smoke test
├── server.js                   # Express entry point
├── ARCHITECTURE.md             # Deep technical walkthrough
├── .env.example                # Environment variable template
├── .gitignore                  # Excludes node_modules/ and .env
└── package.json
```

---

## Live URL

**[LIVE URL]**

To seed/reset data on a fresh deployment: set the `MONGO_URI` environment variable to your Atlas connection string, then run `npm run seed`. The script drops the existing collection first, so it's safe to re-run.

---

## What I'd Improve With More Time

- **Search** — Add a text index on `name` and support a `?search=` query param with `$text` search, combined with cursor pagination.
- **Price range filter** — Add `?minPrice=` and `?maxPrice=` params with a compound index to support filtered pagination on price ranges.
- **Rate limiting** — Add `express-rate-limit` middleware to prevent abuse of the public API.
- **Input validation** — Use a schema validation library (Joi or Zod) for query param validation instead of manual parsing.
- **Testing** — Add a proper test suite with Jest/Supertest for the API routes, including edge cases (invalid cursors, empty results, concurrent inserts).
- **Caching** — Add a Redis caching layer for the `/categories` endpoint since categories rarely change.
- **UI polish** — Virtual scrolling for the product table, loading skeleton states, URL-synced filters so the page is shareable/bookmarkable.
- **Observability** — Structured logging (Winston/Pino) and request timing middleware to monitor query performance in production.

---

## AI Usage

I used AI (Claude) as a pair-programming assistant throughout this project. Here's how:

**What AI helped with:**
- Scaffolding the initial project structure (folder layout, Express boilerplate, Mongoose connection)
- Generating the seed script with batched `insertMany()` and realistic data distribution
- Writing the cursor encoding/decoding logic and the `$or` keyset pagination query
- Building validation and performance benchmark scripts
- Creating the static UI with dark theme styling
- Writing this README

**What I reviewed and verified myself:**
- The cursor pagination query logic — specifically the `$or` condition for compound sort key ties, which is the core correctness guarantee
- Index design — confirmed with `.explain("executionStats")` that queries use IXSCAN and examine only `limit` documents
- Correctness under concurrent inserts — ran a test inserting 50 new products mid-pagination and verified zero duplicates/skips
- Same-millisecond collision handling — validated with 100 identical-`createdAt` documents that the `_id` tiebreaker works
- Performance at scale — benchmarked cursor vs `skip()` at depths up to 190k (cursor is ~80× faster)

**What AI got wrong that I caught:**
- AI's first version of the last-page boundary test (Test 3 in `validatePagination.js`) used the real "Garden" category (~11,000 docs) and computed a page size of `ceil(11063 / 3) + 1 ≈ 3689`. But the API enforces a server-side maximum of `limit = 100`, so every request silently capped to 100 items. The test's safety limit of 20 pages was hit before paginating through all 11k docs, causing a false failure. I caught this, redesigned the test to insert a small controlled dataset (25 docs in a unique test category, paginated with `limit=10`), which correctly produces exactly 3 pages (10 + 10 + 5) and verifies the `nextCursor: null` boundary.
- AI's `explain()` output parser initially only walked the linear `inputStage` chain, missing that `$or` queries produce a `SORT_MERGE` node with multiple `inputStages` (an array). This caused the script to report "no IXSCAN found" even though the query was fully index-driven. I caught the incorrect output and had the parser updated to recursively walk all branches of the execution plan tree.
