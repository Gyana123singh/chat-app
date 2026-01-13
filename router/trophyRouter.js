const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const trophyController = require("../controllers/trophyController");

// Public routes
router.get("/leaderboard", trophyController.getLeaderboard);
router.get("/top-contributors", trophyController.getTopContributors);

// Protected routes
router.get(
  "/contribution-stats",
  authMiddleware,
  trophyController.getUserContributionStats
);
router.get("/user-level", authMiddleware, trophyController.getUserLevel);

module.exports = router;
