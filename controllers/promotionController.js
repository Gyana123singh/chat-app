// controllers/promotion.controller.js
const Banner = require("../models/banner");
const Offer = require("../models/offer");
const Ad = require("../models/ads");
const Popup = require("../models/popup");

const adminOnly = (user) => user.role === "admin";

/* ================== BANNER ================== */
exports.createBanner = async (req, res) => {
  try {
    if (!adminOnly(req.user))
      return res.status(403).json({ message: "Admin only" });

    if (!req.file) return res.status(400).json({ message: "File required" });

    const banner = await Banner.create({
      mediaUrl: req.file.path,
      redirectUrl: req.body.redirectUrl,
      mediaType: req.file.mimetype.startsWith("video")
        ? "video"
        : req.file.mimetype.includes("gif")
          ? "gif"
          : "image",
      createdBy: req.user.id,
    });

    res.json({ success: true, banner });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================== OFFER ================== */
exports.createOffer = async (req, res) => {
  try {
    if (!adminOnly(req.user))
      return res.status(403).json({ message: "Admin only" });

    const offer = await Offer.create({
      title: req.body.title,
      description: req.body.description,
    });

    res.json({ success: true, offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================== AD ================== */
exports.createAd = async (req, res) => {
  try {
    if (!adminOnly(req.user))
      return res.status(403).json({ message: "Admin only" });

    if (!req.file) return res.status(400).json({ message: "File required" });

    const ad = await Ad.create({
      mediaUrl: req.file.path,
      redirectLink: req.body.redirectLink,
      createdBy: req.user.id,
    });

    res.json({ success: true, ad });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================== POPUP ================== */
exports.createPopup = async (req, res) => {
  try {
    if (!adminOnly(req.user))
      return res.status(403).json({ message: "Admin only" });

    const popup = await Popup.create({
      title: req.body.title,
      content: req.body.content,
    });

    res.json({ success: true, popup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET APIs for client side (mobile app / website) so users can only read active data

/* ===================== BANNERS ===================== */
exports.getBanners = async (req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({
      createdAt: -1,
    });

    res.json({
      success: true,
      data: banners,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ===================== OFFERS ===================== */
exports.getOffers = async (req, res) => {
  try {
    const offers = await Offer.find({ isActive: true }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: offers,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ===================== ADS ===================== */
exports.getAds = async (req, res) => {
  try {
    const ads = await Ad.find({ isActive: true }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: ads,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ===================== POPUPS ===================== */
exports.getPopups = async (req, res) => {
  try {
    const userId = req.user.id; // logged-in user

    const popup = await Popup.findOne({
      isActive: true,
      shownTo: { $ne: userId }, // 🔥 not shown before
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: popup || null,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.markPopupSeen = async (req, res) => {
  try {
    const { popupId } = req.body;
    const userId = req.user.id;

    await Popup.findByIdAndUpdate(popupId, {
      $addToSet: { shownTo: userId },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
