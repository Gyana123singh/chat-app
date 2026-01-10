const express = require("express");
const router = express.Router();
const giftController = require("../controllers/storeGiftController");
const { authMiddleware } = require("../middleware/auth");

// Public routes
router.get("/categories", giftController.getAllCategories);
router.get("/by-category/:categoryId", giftController.getGiftsByCategory);
router.get("/:giftId", giftController.getGiftDetails);


// Admin routes
router.post("/create", authMiddleware, giftController.createGift);

module.exports = router;
