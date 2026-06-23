const express = require("express");
const Product = require("../models/Product");

const router = express.Router();

// ── GET /categories ──────────────────────────────────────────────────
// Returns the distinct list of product categories.
// Useful for populating a filter dropdown in the UI.

router.get("/", async (req, res) => {
  try {
    const categories = await Product.distinct("category");
    categories.sort(); // alphabetical for UI convenience
    return res.json({ data: categories });
  } catch (err) {
    console.error("GET /categories error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
