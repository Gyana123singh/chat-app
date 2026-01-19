// routes/promotion.routes.js
const express = require("express");
const router = express.Router();

const upload = require("../middleware/multer.middleware");
const { authMiddleware } = require("../middleware/auth");

const controller = require("../models/notification");

// BANNER
router.post(
  "/create-banner",
  authMiddleware,
  upload.single("file"),
  controller.createBanner,
);

// OFFER
router.post("/create-offer", authMiddleware, controller.createOffer);

// AD
router.post(
  "/create-ads",
  authMiddleware,
  upload.single("file"),
  controller.createAd,
);

// POPUP
router.post("/create-popup", authMiddleware, controller.createPopup);

// PUBLIC APIs (no auth)
router.get("/get-banners", controller.getBanners);
router.get("/get-offers", controller.getOffers);
router.get("/get-ads", controller.getAds);
router.get("/get-popups", authMiddleware, getPopups);
router.post("/popup/seen", authMiddleware, markPopupSeen);

module.exports = router;
