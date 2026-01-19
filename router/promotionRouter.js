// routes/promotion.routes.js
const express = require("express");
const router = express.Router();

const upload = require("../middleware/multer.middleware");
const { authMiddleware } = require("../middleware/auth");

const notificationController = require("../models/notification");

// BANNER
router.post(
  "/create-banner",
  authMiddleware,
  upload.single("file"),
  notificationController.createBanner,
);

// OFFER
router.post(
  "/create-offer",
  authMiddleware,
  notificationController.createOffer,
);

// AD
router.post(
  "/create-ads",
  authMiddleware,
  upload.single("file"),
  notificationController.createAd,
);

// POPUP
router.post(
  "/create-popup",
  authMiddleware,
  notificationController.createPopup,
);

// PUBLIC APIs (no auth)
router.get("/get-banners", notificationController.getBanners);
router.get("/get-offers", notificationController.getOffers);
router.get("/get-ads", notificationController.getAds);
router.get("/get-popups", authMiddleware, notificationController, getPopups);
router.post(
  "/popup/seen",
  authMiddleware,
  notificationController,
  markPopupSeen,
);

module.exports = router;
