const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const levelController = require("../controllers/levelController");

const router = express.Router();
// ===============================
// GET USER LEVEL (PROFILE / APP)
// ===============================
// GET /api/level
router.get("/get-Level", authMiddleware, levelController.getUserLevel);
module.exports = router;
