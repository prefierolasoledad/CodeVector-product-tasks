/**
 * Correctness validation for cursor-based pagination.
 *
 * Tests:
 *   1. Mid-pagination insert stability (50 new docs between page 1 & 2)
 *   2. Category filter + pagination together
 *   3. Last-page boundary (nextCursor: null)
 *   4. Same-createdAt collision handling (no duplicates/skips)
 *
 * Prerequisites:
 *   - Server running on localhost:5000
 *   - Seeded database (200k docs)
 *
 * Run:  node src/scripts/validatePagination.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// =====================================================================
// TEST 1: Mid-pagination insert stability
// Fetch page 1 → insert 50 new products (with createdAt = now, so they
// land at the top) → fetch page 2 with page 1's cursor → confirm:
//   • No overlap between page 1 & page 2
//   • None of the 50 new docs appear in page 2
// =====================================================================
async function test1_insertStability() {
  console.log("\n━━━ Test 1: Mid-pagination insert stability ━━━");

  const LIMIT = 20;

  // Page 1
  const res1 = await fetch(`${BASE}/products?limit=${LIMIT}`);
  const page1 = await res1.json();
  const cursor = page1.nextCursor;
  const page1Ids = new Set(page1.data.map((p) => p._id));

  console.log(`  Page 1: ${page1.data.length} docs fetched`);

  // Insert 50 new products with createdAt = now (top of the list)
  const newDocs = Array.from({ length: 50 }, (_, i) => ({
    name: `NEW-INSERT-${i}`,
    category: "Electronics",
    price: 9.99,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await Product.insertMany(newDocs);
  console.log("  Inserted 50 new products at the top");

  // Page 2 using cursor from page 1
  const res2 = await fetch(`${BASE}/products?limit=${LIMIT}&cursor=${cursor}`);
  const page2 = await res2.json();
  const page2Ids = new Set(page2.data.map((p) => p._id));
  const page2Names = page2.data.map((p) => p.name);

  console.log(`  Page 2: ${page2.data.length} docs fetched`);

  // Check no overlap
  const overlap = page2.data.filter((p) => page1Ids.has(p._id));
  assert(overlap.length === 0, `No overlap between page 1 & 2 (found ${overlap.length})`);

  // Check none of the 50 new docs leaked into page 2
  const leakedNew = page2Names.filter((n) => n.startsWith("NEW-INSERT-"));
  assert(leakedNew.length === 0, `No new inserts leaked into page 2 (found ${leakedNew.length})`);

  // Check page 2 docs are strictly older than page 1's last doc
  const page1LastCreatedAt = new Date(page1.data[page1.data.length - 1].createdAt);
  const page2FirstCreatedAt = new Date(page2.data[0].createdAt);
  assert(
    page2FirstCreatedAt <= page1LastCreatedAt,
    `Page 2 first doc (${page2FirstCreatedAt.toISOString()}) ≤ page 1 last doc (${page1LastCreatedAt.toISOString()})`
  );

  // Verify new docs DO appear on a fresh page 1 (restart from top)
  const resFresh = await fetch(`${BASE}/products?limit=${LIMIT}`);
  const freshPage1 = await resFresh.json();
  const freshNames = freshPage1.data.map((p) => p.name);
  const newInFresh = freshNames.filter((n) => n.startsWith("NEW-INSERT-"));
  assert(newInFresh.length > 0, `New inserts visible on fresh page 1 (found ${newInFresh.length})`);

  // Cleanup: remove the 50 test docs
  await Product.deleteMany({ name: /^NEW-INSERT-/ });
  console.log("  Cleaned up 50 test docs");
}

// =====================================================================
// TEST 2: Category filter + pagination
// Paginate through Electronics with small limit, confirm every doc is
// Electronics and no duplicates across pages.
// =====================================================================
async function test2_categoryFilterPagination() {
  console.log("\n━━━ Test 2: Category filter + pagination ━━━");

  const LIMIT = 50;
  const PAGES_TO_CHECK = 5;
  const allIds = new Set();
  let cursor = null;
  let totalFetched = 0;

  for (let page = 1; page <= PAGES_TO_CHECK; page++) {
    const url = cursor
      ? `${BASE}/products?limit=${LIMIT}&category=Electronics&cursor=${cursor}`
      : `${BASE}/products?limit=${LIMIT}&category=Electronics`;

    const res = await fetch(url);
    const body = await res.json();

    // Every doc must be Electronics
    const nonElectronics = body.data.filter((p) => p.category !== "Electronics");
    assert(
      nonElectronics.length === 0,
      `Page ${page}: all docs are Electronics (${body.data.length} docs, ${nonElectronics.length} wrong)`
    );

    // No duplicates
    const dupes = body.data.filter((p) => allIds.has(p._id));
    assert(dupes.length === 0, `Page ${page}: no duplicates (found ${dupes.length})`);

    body.data.forEach((p) => allIds.add(p._id));
    totalFetched += body.data.length;
    cursor = body.nextCursor;

    // Verify sort order within page (createdAt descending)
    let sorted = true;
    for (let i = 1; i < body.data.length; i++) {
      const prev = new Date(body.data[i - 1].createdAt).getTime();
      const curr = new Date(body.data[i].createdAt).getTime();
      if (curr > prev) {
        sorted = false;
        break;
      }
    }
    assert(sorted, `Page ${page}: createdAt is descending`);
  }

  console.log(`  Total Electronics fetched across ${PAGES_TO_CHECK} pages: ${totalFetched}`);
}

// =====================================================================
// TEST 3: Last-page boundary
// Use a very specific category filter to get a small result set,
// paginate until we hit the end.
// =====================================================================
async function test3_lastPageBoundary() {
  console.log("\n━━━ Test 3: Last-page boundary (nextCursor: null) ━━━");

  // Insert a known small set in a unique category so we control the total
  const TEST_CAT = "__TEST_LAST_PAGE__";
  const TOTAL = 25;
  const LIMIT = 10; // 3 pages: 10, 10, 5

  const docs = Array.from({ length: TOTAL }, (_, i) => ({
    name: `LastPage-${String(i).padStart(3, "0")}`,
    category: TEST_CAT,
    price: 5.0,
    createdAt: new Date(Date.now() - (TOTAL - i) * 1000), // spread 1s apart
    updatedAt: new Date(),
  }));
  await Product.insertMany(docs);
  console.log(`  Inserted ${TOTAL} docs in category "${TEST_CAT}"`);

  let cursor = null;
  let totalFetched = 0;
  let pageCount = 0;

  while (true) {
    const url = cursor
      ? `${BASE}/products?limit=${LIMIT}&category=${encodeURIComponent(TEST_CAT)}&cursor=${cursor}`
      : `${BASE}/products?limit=${LIMIT}&category=${encodeURIComponent(TEST_CAT)}`;

    const res = await fetch(url);
    const body = await res.json();
    pageCount++;
    totalFetched += body.data.length;

    if (!body.nextCursor) {
      assert(
        body.data.length < LIMIT,
        `Last page has fewer than limit (${body.data.length} < ${LIMIT})`
      );
      assert(body.nextCursor === null, `nextCursor is null on last page`);
      break;
    }

    assert(
      body.data.length === LIMIT,
      `Full page has exactly limit docs (${body.data.length} === ${LIMIT})`
    );
    cursor = body.nextCursor;

    if (pageCount > 10) {
      console.log("  ⚠️  Stopped after 10 pages (safety limit)");
      break;
    }
  }

  assert(totalFetched === TOTAL, `Fetched all docs: ${totalFetched} === ${TOTAL}`);

  const expectedPages = Math.ceil(TOTAL / LIMIT); // 3
  assert(pageCount === expectedPages, `Page count: ${pageCount} === expected ${expectedPages}`);
  console.log(`  Paginated through ${pageCount} pages (limit=${LIMIT})`);

  // Cleanup
  await Product.deleteMany({ category: TEST_CAT });
  console.log(`  Cleaned up ${TOTAL} test docs`);
}

// =====================================================================
// TEST 4: Same-createdAt collision handling
// Insert a batch of docs with the EXACT same createdAt, then paginate
// through them and confirm zero duplicates and zero skips.
// =====================================================================
async function test4_sameCreatedAtCollisions() {
  console.log("\n━━━ Test 4: Same-createdAt collision handling ━━━");

  const COLLISION_COUNT = 100;
  const COLLISION_CATEGORY = "__TEST_COLLISION__";
  const FIXED_TS = new Date("2030-01-01T00:00:00.000Z"); // far future so they're at the top

  // Insert 100 docs with identical createdAt
  const collisionDocs = Array.from({ length: COLLISION_COUNT }, (_, i) => ({
    name: `Collision-${String(i).padStart(3, "0")}`,
    category: COLLISION_CATEGORY,
    price: 10.0,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  }));
  await Product.insertMany(collisionDocs);
  console.log(`  Inserted ${COLLISION_COUNT} docs with identical createdAt (${FIXED_TS.toISOString()})`);

  // Paginate through them with a small limit to force many page boundaries
  const LIMIT = 7; // intentionally not a divisor of 100
  let cursor = null;
  const allSeenIds = new Set();
  const allSeenNames = [];
  let pageCount = 0;

  while (true) {
    const url = cursor
      ? `${BASE}/products?limit=${LIMIT}&category=${COLLISION_CATEGORY}&cursor=${cursor}`
      : `${BASE}/products?limit=${LIMIT}&category=${COLLISION_CATEGORY}`;

    const res = await fetch(url);
    const body = await res.json();
    pageCount++;

    // Check for duplicates within this fetch
    for (const doc of body.data) {
      if (allSeenIds.has(doc._id)) {
        console.log(`  ❌ DUPLICATE: ${doc.name} (${doc._id})`);
      }
      allSeenIds.add(doc._id);
      allSeenNames.push(doc.name);
    }

    if (!body.nextCursor) break;
    cursor = body.nextCursor;

    if (pageCount > 50) {
      console.log("  ⚠️  Stopped after 50 pages (safety limit)");
      break;
    }
  }

  assert(
    allSeenIds.size === COLLISION_COUNT,
    `No duplicates & no skips: seen ${allSeenIds.size} unique IDs === ${COLLISION_COUNT} inserted`
  );
  assert(
    allSeenNames.length === COLLISION_COUNT,
    `Total docs returned: ${allSeenNames.length} === ${COLLISION_COUNT}`
  );

  const expectedPages = Math.ceil(COLLISION_COUNT / LIMIT);
  assert(
    pageCount === expectedPages,
    `Page count: ${pageCount} === expected ${expectedPages}`
  );
  console.log(`  Paginated through ${pageCount} pages (limit=${LIMIT})`);

  // Cleanup
  await Product.deleteMany({ category: COLLISION_CATEGORY });
  console.log(`  Cleaned up ${COLLISION_COUNT} collision test docs`);
}

// =====================================================================
// RUNNER
// =====================================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Cursor Pagination — Correctness Validation    ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Connect directly to DB for insert/cleanup operations
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to DB: ${mongoose.connection.host}`);

  await test1_insertStability();
  await test2_categoryFilterPagination();
  await test3_lastPageBoundary();
  await test4_sameCreatedAtCollisions();

  await mongoose.disconnect();

  console.log("\n══════════════════════════════════════════════════");
  console.log(`  Results:  ${passed} passed,  ${failed} failed`);
  console.log("══════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Validation script error:", err);
  process.exit(1);
});
