const StoreGift = require("../models/storeGift");
const cloudinary = require("../config/cloudinary");
const StoreCategory = require("../models/storeCategory");

// for backend side gift store management

// this for admin side to add gift and category
exports.addStoreCategory = async (req, res) => {
  try {
    const { name } = req.body;

    // ✅ Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Store Category name is required",
      });
    }

    // ✅ Check duplicate
    const exists = await StoreCategory.findOne({ name: name.trim() });
    if (exists) {
      return res.status(409).json({
        message: "Store Category already exists",
      });
    }

    // ✅ Create category
    const category = await StoreCategory.create({
      name: name.trim(),
    });

    return res.status(201).json({
      message: "Store StoreCategory added successfully",
      category,
    });
  } catch (error) {
    console.error("Add Store Category Error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
// Get all Store Category

exports.getStoreCategory = async (req, res) => {
  try {
    const categories = await StoreCategory.find().sort({ createdAt: -1 }); // ✅ OLD → NEW (new data at bottom)

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
// Get all gifts by category
exports.getGiftsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { skip = 0, limit = 20 } = req.query;

    let query = { isAvailable: true };

    if (categoryId && categoryId !== "all") {
      query.category = categoryId;
    }

    const gifts = await StoreGift.find(query)
      .populate("category", "name")
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
    return res.status(500).json({
      success: false,
      message: "Error fetching gifts",
      error: error.message,
    });
  }
};

// Get single gift details
exports.getGiftDetails = async (req, res) => {
  try {
    const { giftId } = req.params;

    const gift = await StoreGift.findById(giftId).populate("category", "name");

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
    return res.status(500).json({
      success: false,
      message: "Error fetching gift details",
      error: error.message,
    });
  }
};

// Create gift (ADMIN ONLY)
exports.createGift = async (req, res) => {
  try {
    const { categoryName, description, price, category, animationUrl, rarity } =
      req.body;

    if (!categoryName || !price || !category) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    let icon = "";

    if (req.file) {
      const allowedTypes = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
      ];

      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "Only PNG, JPG, JPEG, GIF are allowed",
        });
      }

      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: "gifts",
        resource_type: "image",
        transformation: [
          { width: 300, height: 300, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
      });

      icon = uploadResult.secure_url;
    }

    const gift = new StoreGift({
      categoryName,
      description,
      icon,
      price,
      category,
      animationUrl,
      rarity,
    });

    await gift.save();
    await gift.populate("category", "categoryName");

    return res.status(201).json({
      success: true,
      message: "Gift created successfully",
      data: gift,
    });
  } catch (error) {
    console.error("Create Gift Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating gift",
      error: error.message,
    });
  }
};

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
      error: error.message,
    });
  }
};
