const StoreGift = require("../models/storeGift");
const StoreCategory = require("../models/storeCategory");
const cloudinary = require("../config/cloudinary");

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
exports.getGiftsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { skip = 0, limit = 20 } = req.query;

    let query = { isAvailable: true };

    if (categoryId && categoryId !== "all") {
      query.category = categoryId;
    }

    const gifts = await StoreGift.find(query)
      .populate("category", "type")
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await StoreGift.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: gifts,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get Gifts Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching gifts",
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
    const {
      name,
      description,
      price,
      category,
      animationUrl,
      rarity,
      effectType,
    } = req.body;

    // ✅ STRONG VALIDATION
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, price and category are required",
      });
    }

    // ✅ OBJECT ID CHECK (THIS FIXES YOUR ERROR)
    if (!mongoose.Types.ObjectId.isValid(category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID",
      });
    }

    const cat = await StoreCategory.findById(category);
    if (!cat) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    let icon = "";
    if (req.file) {
      icon = req.file.path;
    }

    const gift = await StoreGift.create({
      name,
      description,
      icon,
      price,
      category,
      animationUrl,
      rarity,
      effectType: effectType || cat.type || "NONE",
    });

    await gift.populate("category", "type title");

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
