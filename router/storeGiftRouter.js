const express = require("express");
const router = express.Router();
const giftController = require("../controllers/storeGiftController");
const { authMiddleware } = require("../middleware/auth");
const multer = require("../middleware/multer.middleware");

// Public routes
router.get("/categories", giftController.getAllCategories);
router.get("/by-category/:categoryId", giftController.getGiftsByCategory);
router.get("/:giftId", giftController.getGiftDetails);

// Admin routes
router.post(
  "/create",
  multer.single("icon"),
  authMiddleware,
  giftController.createGift
);

module.exports = router;
