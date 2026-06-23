/**
 * Performance validation — .explain("executionStats") analysis
 * and cursor vs skip() comparison at deep pages.
 *
 * Run:  node src/scripts/perfValidation.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

// ── Helpers ──────────────────────────────────────────────────────────
function printExplain(label, stats) {
  // Recursively collect all stage names and index names from the tree.
  // SORT_MERGE has `inputStages` (array) instead of `inputStage`.
  const stageNames = [];
  const indexNames = [];

  function walk(node) {
    if (!node) return;
    stageNames.push(node.stage);
    if (node.indexName) indexNames.push(node.indexName);
    if (node.inputStage) walk(node.inputStage);
    if (node.inputStages) node.inputStages.forEach(walk);
  }
  walk(stats.executionStages);

  const uniqueStages = [...new Set(stageNames)];
  const isIXSCAN = uniqueStages.includes("IXSCAN");
  const isCOLLSCAN = uniqueStages.includes("COLLSCAN");

  console.log(`\n  📊 ${label}`);
  console.log(`     Stage chain      : ${stageNames.join(" → ")}`);
  console.log(`     Index used       : ${indexNames.length ? indexNames.join(", ") : "(none)"}`);
  console.log(`     Docs examined    : ${stats.totalDocsExamined}`);
  console.log(`     Keys examined    : ${stats.totalKeysExamined}`);
  console.log(`     Docs returned    : ${stats.nReturned}`);
  console.log(`     Execution time   : ${stats.executionTimeMillis} ms`);

  const efficient = stats.totalDocsExamined <= stats.nReturned * 1.1;

  if (isIXSCAN && !isCOLLSCAN) {
    console.log(`     ✅ IXSCAN (index-driven, no collection scan)`);
  } else if (isCOLLSCAN) {
    console.log(`     ❌ COLLSCAN — full collection scan`);
  } else {
    console.log(`     ⚠️  No IXSCAN found — check plan`);
  }
  if (efficient) {
    console.log(`     ✅ Efficient: examined ≈ returned (${stats.totalDocsExamined} ≈ ${stats.nReturned})`);
  } else {
    console.log(`     ⚠️  Examined ${stats.totalDocsExamined} docs to return ${stats.nReturned}`);
  }

  return { isIXSCAN, efficient };
}

function formatMs(ms) {
  return ms < 1 ? "<1 ms" : `${ms} ms`;
}

// =====================================================================
// TEST A: Deep-page cursor query — full collection (no category filter)
// Simulate being on "page 5000" by grabbing a doc ~100k deep, then
// using its (createdAt, _id) as the cursor.
// =====================================================================
async function testA_deepCursorExplain() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Test A: Deep-page cursor query (no filter)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const LIMIT = 20;

  // Grab a doc roughly halfway through (simulate deep pagination)
  const pivot = await Product.findOne()
    .sort({ createdAt: -1, _id: -1 })
    .skip(100_000)
    .lean();

  console.log(`  Pivot doc: createdAt=${pivot.createdAt.toISOString()}, _id=${pivot._id}`);

  // This is the exact query the route runs for a cursor page
  const cursorFilter = {
    $or: [
      { createdAt: { $lt: pivot.createdAt } },
      { createdAt: pivot.createdAt, _id: { $lt: pivot._id } },
    ],
  };

  const explain = await Product.find(cursorFilter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIMIT)
    .explain("executionStats");

  printExplain("Deep cursor (100k deep, limit 20)", explain.executionStats);
}

// =====================================================================
// TEST B: Category-filtered cursor query
// Same idea but with category = "Electronics"
// =====================================================================
async function testB_categoryFilteredExplain() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Test B: Category-filtered cursor query");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const LIMIT = 20;
  const CATEGORY = "Electronics";

  // Grab a pivot doc ~halfway through Electronics
  const electronicsCount = await Product.countDocuments({ category: CATEGORY });
  const skipAmount = Math.floor(electronicsCount / 2);

  const pivot = await Product.findOne({ category: CATEGORY })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skipAmount)
    .lean();

  console.log(`  Electronics count: ${electronicsCount}`);
  console.log(`  Pivot doc (skip ${skipAmount}): createdAt=${pivot.createdAt.toISOString()}, _id=${pivot._id}`);

  // Exact query the route builds for category + cursor
  const filter = {
    $and: [
      { category: CATEGORY },
      {
        $or: [
          { createdAt: { $lt: pivot.createdAt } },
          { createdAt: pivot.createdAt, _id: { $lt: pivot._id } },
        ],
      },
    ],
  };

  const explain = await Product.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIMIT)
    .explain("executionStats");

  printExplain(`Category="${CATEGORY}" cursor (skip ${skipAmount} deep, limit ${LIMIT})`, explain.executionStats);
}

// =====================================================================
// TEST C: Cursor vs Skip — timing comparison at deep pages
// The whole reason we're doing cursor pagination.
// =====================================================================
async function testC_cursorVsSkip() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Test C: Cursor vs Skip — timing at deep pages");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const LIMIT = 20;
  const depths = [100, 1_000, 10_000, 50_000, 100_000, 190_000];

  console.log(`\n  ${"Depth".padStart(8)}  |  ${"skip()".padStart(10)}  |  ${"cursor".padStart(10)}  |  speedup`);
  console.log(`  ${"─".repeat(8)}  |  ${"─".repeat(10)}  |  ${"─".repeat(10)}  |  ${"─".repeat(8)}`);

  for (const depth of depths) {
    // ── Get pivot doc for cursor approach ──────────────────────
    const pivot = await Product.findOne()
      .sort({ createdAt: -1, _id: -1 })
      .skip(depth)
      .lean();

    if (!pivot) {
      console.log(`  ${String(depth).padStart(8)}  |  (skip exceeds collection size)`);
      continue;
    }

    // ── Skip approach (what you'd do with offset pagination) ──
    const t0Skip = Date.now();
    const skipExplain = await Product.find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip(depth)
      .limit(LIMIT)
      .explain("executionStats");
    const skipMs = Date.now() - t0Skip;
    const skipExamined = skipExplain.executionStats.totalDocsExamined;

    // ── Cursor approach ────────────────────────────────────────
    const cursorFilter = {
      $or: [
        { createdAt: { $lt: pivot.createdAt } },
        { createdAt: pivot.createdAt, _id: { $lt: pivot._id } },
      ],
    };

    const t0Cursor = Date.now();
    const cursorExplain = await Product.find(cursorFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(LIMIT)
      .explain("executionStats");
    const cursorMs = Date.now() - t0Cursor;
    const cursorExamined = cursorExplain.executionStats.totalDocsExamined;

    const speedup = skipMs > 0 ? (skipMs / Math.max(cursorMs, 1)).toFixed(1) : "∞";

    console.log(
      `  ${String(depth).padStart(8)}  |` +
      `  ${formatMs(skipMs).padStart(10)}  |` +
      `  ${formatMs(cursorMs).padStart(10)}  |` +
      `  ${String(speedup + "×").padStart(8)}`
    );
    console.log(
      `  ${"".padStart(8)}  |` +
      `  ${(skipExamined + " docs").padStart(10)}  |` +
      `  ${(cursorExamined + " docs").padStart(10)}  |`
    );
  }

  console.log(`
  Key insight: skip(N) must walk through N documents every time (O(n)),
  while cursor pagination jumps directly to the right position via the
  index (O(log n) seek + limit reads). At 190k depth the difference is
  dramatic — this is exactly why offset/skip pagination breaks at scale.`);
}

// =====================================================================
// RUNNER
// =====================================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   Performance Validation — explain() & benchmarks   ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to DB: ${mongoose.connection.host}`);

  await testA_deepCursorExplain();
  await testB_categoryFilteredExplain();
  await testC_cursorVsSkip();

  await mongoose.disconnect();
  console.log("\nDone. Disconnected.");
}

main().catch((err) => {
  console.error("Performance validation error:", err);
  process.exit(1);
});
