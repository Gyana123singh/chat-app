const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth");
const cpController = require("../controllers/cpController");

// Get CP status
// GET /api/cp
router.get("/get-cp-status", authMiddleware, cpController.getCP);

// Claim CP → Coins
// POST /api/cp/claim
router.post("/claim", authMiddleware, cpController.claimCP);

module.exports = router;
