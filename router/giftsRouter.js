const express = require("express");
const router = express.Router();

const giftController = require("../controllers/giftController");
const { authMiddleware } = require("../middleware/auth");
const multer = require("../middleware/multer.middleware");



router.post("/addGift", multer.single("image"), giftController.addGift);
router.get("/getAllGift", giftController.getAllGifts);
router.post("/addCategory", giftController.addCategory);
router.get("/getCategory", giftController.getCategory);


// // routes/gifts.js
// const express = require('express');
// const router = express.Router();
// const giftController = require('../controllers/giftController');
// const { authMiddleware } = require('../middleware/auth');

// router.get('/', giftController.getAllGifts);
// router.post('/send', authMiddleware, giftController.sendGift);
// router.get('/history', authMiddleware, giftController.getGiftHistory);
// router.get('/leaderboard', giftController.getLeaderboard);

module.exports = router;
