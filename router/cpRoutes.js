const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const cpController = require("../controllers/cpController");

/*
=================================
        CP ROUTES
=================================
*/

// ✅ Get CP status
// GET /api/cp/status
router.get(
  "/cp-status",
  authMiddleware,
  cpController.getCP
);

// ✅ Claim CP → Coins
// POST /api/cp/claim
router.post(
  "/cp-claim",
  authMiddleware,
  cpController.claimCP
);

// ✅ CP History (WAFA style)
// GET /api/cp/history
router.get(
  "/cp-history",
  authMiddleware,
  cpController.getCPHistory
);

module.exports = router;
