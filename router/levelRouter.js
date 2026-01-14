const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const levelController = require("../controllers/levelController");

const router = express.Router();

// Protected routes
router.get("/user-level", authMiddleware, levelController.getUserLevel);
router.get("/benefits", authMiddleware, levelController.getLevelBenefits);
router.get(
  "/ways-to-levelup",
  authMiddleware,
  levelController.getWaysToLevelUp
);
router.get("/rewards", authMiddleware, levelController.getLevelUpRewards);

// Add EXP routes
router.post("/add-exp-ludo", authMiddleware, levelController.addExpPlayLudo);
router.post("/add-exp-room", authMiddleware, levelController.addExpStayInRoom);

// Claim rewards
router.post(
  "/claim-reward",
  authMiddleware,
  levelController.claimLevelUpReward
);

module.exports = router;
