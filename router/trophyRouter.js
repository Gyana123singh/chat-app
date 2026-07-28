const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const trophyController = require("../controllers/trophyController");

/**
 * 🏆 PUBLIC ROUTES - No auth required
 */

// Get full leaderboard with pagination
// Query: ?period=daily|weekly|monthly|allTime&page=1&limit=20
router.get("/leaderboard", trophyController.getLeaderboard);

// Get top 10 contributors for quick display
// Query: ?period=daily|weekly|monthly|allTime
router.get("/top-contributors", trophyController.getTopContributors);

// Get total contribution for a specific room
router.get("/room-contribution/:roomId", trophyController.getRoomContribution);

/**
 * 🏆 PROTECTED ROUTES - Auth required
 */

// Get user's personal contribution stats
router.get(
  "/contribution-stats",
  authMiddleware,
  trophyController.getUserContributionStats
);

// Get user's level and achievements
router.get("/user-level", authMiddleware, trophyController.getUserLevel);

module.exports = router;
