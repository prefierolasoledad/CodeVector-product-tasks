/**
 * Quick smoke test — fetches page 1 & page 2, then a category-filtered page.
 * Run:  node src/scripts/testPagination.js
 */

const BASE = "http://localhost:5000";

async function run() {
  // ── Page 1 (no cursor, limit 3) ────────────────────────────────
  const res1 = await fetch(`${BASE}/products?limit=3`);
  const page1 = await res1.json();
  console.log("=== Page 1 (3 newest) ===");
  page1.data.forEach((p) =>
    console.log(`  ${p.name}  |  ${p.category}  |  $${p.price}  |  ${p.createdAt}`)
  );
  console.log("nextCursor:", page1.nextCursor, "\n");

  // ── Page 2 (using cursor from page 1) ──────────────────────────
  const res2 = await fetch(`${BASE}/products?limit=3&cursor=${page1.nextCursor}`);
  const page2 = await res2.json();
  console.log("=== Page 2 (next 3) ===");
  page2.data.forEach((p) =>
    console.log(`  ${p.name}  |  ${p.category}  |  $${p.price}  |  ${p.createdAt}`)
  );
  console.log("nextCursor:", page2.nextCursor, "\n");

  // ── No overlap check ──────────────────────────────────────────
  const ids1 = new Set(page1.data.map((p) => p._id));
  const overlap = page2.data.filter((p) => ids1.has(p._id));
  console.log(`Overlap between page 1 & 2: ${overlap.length} (should be 0)\n`);

  // ── Category filter ────────────────────────────────────────────
  const res3 = await fetch(`${BASE}/products?limit=3&category=Electronics`);
  const filtered = await res3.json();
  console.log("=== Electronics (first 3) ===");
  filtered.data.forEach((p) =>
    console.log(`  ${p.name}  |  ${p.category}  |  $${p.price}  |  ${p.createdAt}`)
  );
  console.log("nextCursor:", filtered.nextCursor, "\n");

  // ── Categories endpoint ────────────────────────────────────────
  const res4 = await fetch(`${BASE}/categories`);
  const cats = await res4.json();
  console.log("=== All categories ===");
  console.log(" ", cats.data.join(", "));
}

run().catch(console.error);
