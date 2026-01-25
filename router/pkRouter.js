const express = require("express");
const router = express.Router();

const { createPK } = require("../controllers/pkController");
const { authMiddleware } = require("../middleware/auth"); // your JWT middleware

// ==========================
// 🔥 CREATE PK
// ==========================
// Only room host can start PK
// POST /api/pk/create
router.post("/create-pk", authMiddleware, createPK);

module.exports = router;
