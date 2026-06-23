const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Product name is required"],
    trim: true,
  },
  category: {
    type: String,
    required: [true, "Category is required"],
    trim: true,
  },
  price: {
    type: Number,
    required: [true, "Price is required"],
    min: [0, "Price cannot be negative"],
  },
  // Explicit Date fields instead of `timestamps: true`.
  // Rationale: the seed script needs to set createdAt manually to spread
  // products across a realistic historical range. With explicit fields,
  // the seed script simply passes a createdAt value; for normal app inserts
  // the default kicks in and sets it to now.
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ── Indexes ──────────────────────────────────────────────────────────
// Compound index for cursor-based pagination sorted "newest first".
// _id is a monotonically-increasing ObjectId that serves as a tiebreaker
// when multiple documents share the same createdAt millisecond
// (common at 200k inserts).
productSchema.index({ createdAt: -1, _id: -1 });

// Compound index for filtered-by-category cursor pagination.
// Mongo uses the equality prefix (category) to narrow, then walks the
// sort suffix (createdAt desc, _id desc) in index order — one IXSCAN,
// no in-memory sort.
productSchema.index({ category: 1, createdAt: -1, _id: -1 });

// ── Hooks ────────────────────────────────────────────────────────────
// Auto-update `updatedAt` on every save so normal app mutations stay
// hands-free. The seed script bypasses this because it uses insertMany
// (which does not trigger save hooks).
productSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Product", productSchema);
