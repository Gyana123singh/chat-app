const express = require("express");
const router = express.Router();

const {
  createPK,
  getPKHistory,
  getPKLeaderboard,
} = require("../controllers/pkController");
const { authMiddleware } = require("../middleware/auth"); // your JWT middleware

// ==========================
// 🔥 CREATE PK
// ==========================
// Only room host can start PK
// POST /api/pk/create
router.post("/create-pk", createPK);

// GET PK HISTORY
router.get("/history", authMiddleware, getPKHistory);

// GET PK LEADERBOARD
router.get("/leaderboard", getPKLeaderboard);
module.exports = router;
