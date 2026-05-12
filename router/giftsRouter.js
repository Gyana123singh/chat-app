const express = require("express");
const router = express.Router();

const giftController = require("../controllers/giftController");
const { authMiddleware } = require("../middleware/auth");
const multer = require("../middleware/multer.middleware");

router.post("/addGift", multer.single("icon"), giftController.addGift);
router.get("/getAllGift", giftController.getAllGifts);
router.post("/addCategory", giftController.addCategory);
router.get("/getCategory", giftController.getCategory);
router.post(
  "/check-eligibility",
  authMiddleware,
  giftController.checkEligibility,
);


// Get all gift transactions in a room
router.get("/room/:roomId", authMiddleware, giftController.getGiftTransactions);

// Get gifts received by a user
router.get(
  "/received-gift",
  authMiddleware,
  giftController.getUserReceivedGifts,
);
router.get(
  "/get-gift-by-category/:category",
  giftController.getGiftsByCategory,
);

// Get gift sending analytics for a user
router.get("/analytics", authMiddleware, giftController.getGiftAnalytics);

// Get gift wall (sent and received history) for any specific user profile
router.get("/wall/:userId", authMiddleware, giftController.getGiftWall);

module.exports = router;
