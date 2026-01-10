const express = require("express");
const router = express.Router();
const giftSendController = require("../controllers/storeGiftSendController");
const { authMiddleware } = require("../middleware/auth");

// Get friends list
router.get("/friends", authMiddleware, giftSendController.getFriendsForGift);

// Send gift operations
router.post("/send-to-user", authMiddleware, giftSendController.sendGiftToUser);
router.post(
  "/send-to-multiple",
  authMiddleware,
  giftSendController.sendGiftToMultipleUsers
);
router.post("/send-to-room", authMiddleware, giftSendController.sendGiftToRoom);

// Get user's gifts
router.get("/my-gifts", authMiddleware, giftSendController.getUserGifts);

// Get transaction history
router.get(
  "/history",
  authMiddleware,
  giftSendController.getTransactionHistory
);

module.exports = router;
