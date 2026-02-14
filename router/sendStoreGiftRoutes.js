const express = require("express");
const router = express.Router();
const giftSendController = require("../controllers/storeGiftSendController");
const { authMiddleware } = require("../middleware/auth");

// Send gift operations
router.post("/send-gift", authMiddleware, giftSendController.sendGift);

module.exports = router;
