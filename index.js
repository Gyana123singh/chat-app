const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");

dotenv.config();
require("./config/passport");

const { connectMongose } = require("./config/mongoDb");
const authRoutes = require("./router/authRouter");
const adminRoutes = require("./router/adminRouter");

const app = express();

// 🔹 Connect MongoDB
connectMongose();

// 🔹 Render provides PORT automatically
const PORT = process.env.PORT || 5000;

// 🔹 Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",              // local Next.js
      "https://your-nextjs-domain.com"      // 🔁 replace when deployed
    ],
    credentials: true,
  })
);

app.use(express.json());
app.use(passport.initialize()); // ✅ NO session

// 🔹 Routes
app.use("/auth", authRoutes);
app.use("/api", adminRoutes);

// 🔹 Health check
app.get("/", (req, res) => {
  res.send("API is running...");
});

// 🔹 Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
