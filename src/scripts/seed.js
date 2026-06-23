/**
 * Seed script — inserts 200,000 products in batched insertMany() calls.
 *
 * Usage:  npm run seed          (uses MONGO_URI from .env)
 *
 * Idempotent: drops the products collection before seeding so re-runs
 * always produce exactly 200,000 documents.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

// ── Tuning knobs ─────────────────────────────────────────────────────
const TOTAL_DOCS = 200_000;
const BATCH_SIZE = 5_000; // docs per insertMany round-trip
const TOTAL_BATCHES = Math.ceil(TOTAL_DOCS / BATCH_SIZE);

// ── Name generation (adjective + noun, cheap & varied) ───────────────
const ADJECTIVES = [
  "Premium", "Classic", "Ultra", "Eco", "Smart",
  "Vintage", "Pro", "Mini", "Mega", "Lite",
  "Elite", "Turbo", "Flex", "Prime", "Nova",
];

const NOUNS = [
  "Widget", "Gadget", "Sensor", "Module", "Adapter",
  "Controller", "Display", "Speaker", "Charger", "Cable",
  "Keyboard", "Mouse", "Stand", "Light", "Hub",
];

// ── Categories (intentionally uneven — some will be much larger) ─────
// Weighted by repeating popular categories so random picks skew toward them.
const CATEGORIES_WEIGHTED = [
  "Electronics", "Electronics", "Electronics",   // ~heavy
  "Clothing", "Clothing",                         // ~medium
  "Home & Kitchen", "Home & Kitchen",             // ~medium
  "Sports", "Sports",                             // ~medium
  "Books",                                        // ~lighter
  "Toys",                                         // ~lighter
  "Beauty",
  "Automotive",
  "Garden",
  "Office Supplies",
  "Pet Supplies",
  "Health",
  "Grocery",
];

// ── Helpers ──────────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomPrice = () => +(Math.random() * 999 + 1).toFixed(2); // 1.00–1000.00

/**
 * Spread createdAt across the past ~2 years.
 * Strategy: base timestamp walks forward sequentially (so there IS a
 * global ordering), but each stamp gets a small random jitter so many
 * documents share the same millisecond — exercising the _id tiebreaker.
 */
const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;
const START_TS = Date.now() - TWO_YEARS_MS;
const STEP_MS = TWO_YEARS_MS / TOTAL_DOCS; // ~315 ms per doc on average

function buildBatch(batchIndex) {
  const docs = new Array(BATCH_SIZE);
  const offset = batchIndex * BATCH_SIZE;

  for (let i = 0; i < BATCH_SIZE; i++) {
    const seqIndex = offset + i;
    if (seqIndex >= TOTAL_DOCS) {
      docs.length = i; // trim last partial batch
      break;
    }

    // Sequential base + small jitter (±50 ms) so some docs collide on ms
    const jitter = Math.floor(Math.random() * 100) - 50;
    const ts = new Date(START_TS + seqIndex * STEP_MS + jitter);

    docs[i] = {
      name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
      category: pick(CATEGORIES_WEIGHTED),
      price: randomPrice(),
      createdAt: ts,
      updatedAt: ts,
    };
  }
  return docs;
}

// ── Main ─────────────────────────────────────────────────────────────
async function seed() {
  console.log(`Connecting to MongoDB…`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  // Idempotent: drop existing products so re-runs don't stack
  await Product.collection.drop().catch((err) => {
    // "ns not found" just means the collection didn't exist yet — fine
    if (err.codeName !== "NamespaceNotFound") throw err;
  });
  console.log("Dropped existing products collection (if any).\n");

  const t0 = Date.now();

  for (let b = 0; b < TOTAL_BATCHES; b++) {
    const docs = buildBatch(b);
    await Product.insertMany(docs, { ordered: false });

    const inserted = (b + 1) * BATCH_SIZE > TOTAL_DOCS
      ? TOTAL_DOCS
      : (b + 1) * BATCH_SIZE;
    console.log(
      `  Batch ${String(b + 1).padStart(2)}/${TOTAL_BATCHES}  —  ` +
      `${inserted.toLocaleString()} / ${TOTAL_DOCS.toLocaleString()} docs`
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\n✓ Seeding complete in ${elapsed}s`);

  // ── Verify ───────────────────────────────────────────────────────
  const count = await Product.countDocuments();
  console.log(`  Documents in collection: ${count.toLocaleString()}`);

  const indexes = await Product.collection.indexes();
  console.log(`  Indexes:`);
  indexes.forEach((idx) => {
    console.log(`    • ${idx.name}  →  ${JSON.stringify(idx.key)}`);
  });

  if (count !== TOTAL_DOCS) {
    console.error(`\n✗ Expected ${TOTAL_DOCS} but found ${count}`);
    process.exit(1);
  }

  await mongoose.disconnect();
  console.log(`\nDone. Disconnected.`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
