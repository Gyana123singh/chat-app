const StoreGift = require("../models/storeGift");
const StoreCategory = require("../models/storeCategory");
const cloudinary = require("../config/cloudinary");

/* ===============================
   ADD STORE CATEGORY (ADMIN)
================================ */
exports.addStoreCategory = async (req, res) => {
  try {
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Category name and type are required",
      });
    }

    const category = await StoreCategory.create({
      type,
    });

    return res.status(201).json({
      success: true,
      message: "Store category created",
      data: category,
    });
  } catch (error) {
    console.error("Add Store Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
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
    const { categoryId } = req.params; // ENTRANCE, FRAME, etc
    const { skip = 0, limit = 20 } = req.query;

    const pipeline = [
      {
        $lookup: {
          from: "storegiftcategories", // 🔥 CHANGE THIS TO YOUR REAL COLLECTION NAME
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" },
      {
        $match: {
          isAvailable: true,
        },
      },
    ];

    if (categoryId !== "ALL") {
      pipeline.push({
        $match: {
          "category.type": categoryId,
        },
      });
    }

    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: parseInt(skip) },
      { $limit: parseInt(limit) }
    );

    const gifts = await StoreGift.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      data: gifts,
      pagination: {
        total: gifts.length,
        skip: parseInt(skip),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ Filter Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
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

    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, price and category are required",
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
      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: "store_gifts",
        resource_type: "image",
      });

      icon = uploadResult.secure_url;
    }

    const gift = await StoreGift.create({
      name,
      price,
      category,
      icon,
      effectType: cat.type, // 🔥 auto map
    });

    await gift.populate("category", "type");

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
