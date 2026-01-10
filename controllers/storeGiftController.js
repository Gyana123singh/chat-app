const StoreGift = require("../models/storeGift");
const StoreCategory = require("../models/storeCategory");

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

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await StoreCategory.find();

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching categories",
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
    const { name, description, icon, price, category, animationUrl, rarity } =
      req.body;

    // Validate required fields
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const gift = new StoreGift({
      name,
      description,
      icon,
      price,
      category,
      animationUrl,
      rarity,
    });

    await gift.save();
    await gift.populate("category", "name");

    return res.status(201).json({
      success: true,
      message: "Gift created successfully",
      data: gift,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating gift",
      error: error.message,
    });
  }
};
