const express = require("express");
const Product = require("../models/Product");

const router = express.Router();

// ── Cursor helpers ───────────────────────────────────────────────────
// Cursor is a Base64-encoded JSON string: { createdAt, _id }
// Base64 makes it opaque to the client (they can't easily tamper with it
// or assume its structure), URL-safe, and trivial to decode server-side.
// Tradeoff vs. sending raw values: slightly larger payload, but the client
// treats it as a single opaque token — no need to know about internal
// sort keys, and we can change the encoding later without breaking clients.

function encodeCursor(doc) {
  const payload = JSON.stringify({
    createdAt: doc.createdAt.toISOString(),
    _id: doc._id.toString(),
  });
  return Buffer.from(payload).toString("base64url");
}

function decodeCursor(cursorStr) {
  try {
    const json = Buffer.from(cursorStr, "base64url").toString("utf8");
    const { createdAt, _id } = JSON.parse(json);
    return { lastCreatedAt: new Date(createdAt), lastId: _id };
  } catch {
    return null;
  }
}

// ── GET /products ────────────────────────────────────────────────────
// Query params:
//   limit    — page size (default 20, max 100)
//   category — optional filter
//   cursor   — opaque string from a previous response's nextCursor
//
// Response: { data: [...], nextCursor: "..." | null }
//
// Why this is duplicate/skip-safe:
//   • A NEW product inserted at the top has a createdAt > everything
//     already fetched, so it will never appear in a $lt range query for
//     a cursor a user already holds — no duplicates, no skips for pages
//     already turned. It correctly shows up when the user restarts from
//     page 1.
//   • An UPDATE to an existing, already-passed product doesn't change its
//     createdAt, so it doesn't move and doesn't get duplicated either.

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const { category, cursor } = req.query;

    // ── Build filter ───────────────────────────────────────────────
    const filter = {};

    if (category) {
      filter.category = category;
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const { lastCreatedAt, lastId } = decoded;

      // Keyset pagination range condition for compound sort
      // { createdAt: -1, _id: -1 }:
      //   Either createdAt is strictly less (older),
      //   OR     createdAt is the same AND _id is strictly less.
      const cursorFilter = {
        $or: [
          { createdAt: { $lt: lastCreatedAt } },
          { createdAt: lastCreatedAt, _id: { $lt: lastId } },
        ],
      };

      // Merge with category filter using $and if both are present
      if (category) {
        filter.$and = [{ category }, cursorFilter];
        delete filter.category; // moved into $and
      } else {
        Object.assign(filter, cursorFilter);
      }
    }

    // ── Query ──────────────────────────────────────────────────────
    const products = await Product.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    // ── Build next cursor ──────────────────────────────────────────
    let nextCursor = null;
    if (products.length === limit) {
      const lastDoc = products[products.length - 1];
      nextCursor = encodeCursor(lastDoc);
    }

    return res.json({ data: products, nextCursor });
  } catch (err) {
    console.error("GET /products error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
