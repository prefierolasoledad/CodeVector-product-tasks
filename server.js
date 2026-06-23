require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const connectDB = require("./src/config/db");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static UI
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/products", require("./src/routes/productRoutes"));
app.use("/categories", require("./src/routes/categoryRoutes"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ message: "API is running..." });
});

// Connect to DB and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
