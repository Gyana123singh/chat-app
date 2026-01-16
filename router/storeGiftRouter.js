const express = require("express");
const router = express.Router();
const giftController = require("../controllers/storeGiftController");
const { authMiddleware } = require("../middleware/auth");
const multer = require("../middleware/multer.middleware");

// Public routes
router.post("/addStoreCategory", giftController.addStoreCategory);
router.get("/getStoreCategory", giftController.getStoreCategory);
router.get("/get-gift-by-category", giftController.getGiftsByCategory);
router.get("/:giftId", giftController.getGiftDetails);
router.delete("/delete/:giftId", giftController.deleteGift);

// Admin routes
router.post("/create", multer.single("icon"), giftController.createGift);

module.exports = router;
