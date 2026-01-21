// routes/promotion.routes.js
const express = require("express");
const router = express.Router();

const upload = require("../middleware/multer.middleware");
const { authMiddleware } = require("../middleware/auth");
const promotionController = require("../controllers/promotionController");

// BANNER
router.post(
  "/create-banner",
  authMiddleware,
  upload.single("file"),
  promotionController.createBanner,
);

// OFFER
router.post("/create-offer", authMiddleware, promotionController.createOffer);

// AD
router.post(
  "/create-ads",
  authMiddleware,
  upload.single("file"),
  promotionController.createAd,
);

// POPUP
router.post("/create-popup", authMiddleware, promotionController.createPopup);

// PUBLIC APIs (no auth)
router.get("/get-banners", promotionController.getBanners);
router.get("/get-offers", promotionController.getOffers);
router.get("/get-ads", promotionController.getAds);
router.get("/get-popup", authMiddleware, promotionController.getPopups);
router.post("/popup/seen", authMiddleware, promotionController.markPopupSeen);

module.exports=router
