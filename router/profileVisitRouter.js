// routes/profileVisit.routes.js
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const profileVisitController = require("../controllers/profileVisitController");

router.post("/visit", authMiddleware, profileVisitController.recordVisit);
router.get("/list", authMiddleware, profileVisitController.getVisitors);

module.exports = router;
