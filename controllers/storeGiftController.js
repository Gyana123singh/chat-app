const StoreGift = require("../models/storeGift");
const StoreCategory = require("../models/storeCategory");
const cloudinary = require("../config/cloudinary");
const mongoose = require("mongoose");

/* ===============================
   ADD STORE CATEGORY (ADMIN)
================================ */
// controllers/storeGiftController.js
// controllers/storeGiftController.js
exports.addStoreCategory = async (req, res) => {
  try {
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Category type is required",
      });
    }

    const allowedTypes = [
      "ENTRANCE",
      "FRAME",
      "RING",
      "BUBBLE",
      "THEME",
      "EMOJI",
      "NONE",
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category type",
      });
    }

    const exists = await StoreCategory.findOne({ type });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Category already exists",
      });
    }

    const category = await StoreCategory.create({
      type,
      title: type, // display same as type
    });

    return res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("❌ Add Category Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/* ===============================
   GET ALL CATEGORIES
================================ */
/* ===============================
   GET ALL CATEGORIES (TABS)
================================ */
exports.getStoreCategory = async (req, res) => {
  try {
    const categories = await StoreCategory.find({ isActive: true })
      .select("type -_id")
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/* ===============================
   GET GIFTS BY CATEGORY
================================ */
// GET /api/store-gifts/category/:category
exports.getGiftsByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    const gifts = await StoreGift.find({
      category: category,
      isAvailable: true,
    });

    return res.status(200).json({
      success: true,
      data: gifts,
    });
  } catch (error) {
    console.error("❌ Fetch By Category Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching gifts by category",
    });
  }
};

/* ===============================
   GET SINGLE GIFT DETAILS
================================ */
exports.getGiftDetails = async (req, res) => {
  try {
    const { giftId } = req.params;

    const gift = await StoreGift.findById(giftId).populate(
      "category",
      "name type"
    );

    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: gift,
    });
  } catch (error) {
    console.error("Get Gift Details Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching gift details",
    });
  }
};

/* ===============================
   DELETE GIFT (ADMIN)
================================ */
exports.deleteGift = async (req, res) => {
  try {
    const { giftId } = req.params;

    const gift = await StoreGift.findByIdAndDelete(giftId);

    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Gift deleted successfully",
    });
  } catch (error) {
    console.error("Delete Gift Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting gift",
    });
  }
};

/* ===============================
   CREATE GIFT (ADMIN)
================================ */

exports.createGift = async (req, res) => {
  try {
    const { name, price, category } = req.body;

    // Validation
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, price and category are required",
      });
    }

    let icon = "";
    if (req.file) {
      icon = req.file.path;
    }

    const gift = await StoreGift.create({
      name,
      price,
      category, // string now
      icon,
    });

    return res.status(201).json({
      success: true,
      message: "Gift created successfully",
      data: gift,
    });
  } catch (error) {
    console.error("❌ Create Gift Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error creating gift",
    });
  }
};
