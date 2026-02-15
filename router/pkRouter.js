const express = require("express");
const router = express.Router();

const {
  createPK,
  endPK,
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

module.exports = router;
