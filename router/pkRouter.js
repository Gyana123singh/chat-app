const express = require("express");
const router = express.Router();

const {
  createPK,
  endPK,
  getPKHistory,
  getPKLeaderboard,
} = require("../controllers/pkController");
const { authMiddleware } = require("../middleware/auth"); // your JWT middleware

// ==========================
// 🔥 CREATE PK
// ==========================
// Only room host can start PK
// POST /api/pk/create
router.post("/create-pk", authMiddleware, createPK);

// End PK manually (optional)
router.post("/end/:pkId", authMiddleware, endPK);

// PK History by room
router.get("/history/:roomId", getPKHistory);

// PK Leaderboard
router.get("/leaderboard", getPKLeaderboard);

module.exports = router;
