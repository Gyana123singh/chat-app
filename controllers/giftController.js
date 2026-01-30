const cloudinary = require("../config/cloudinary");
const User = require("../models/users");
const Category = require("../models/category");
const Room = require("../models/room");
const Gift = require("../models/gifts");
const GiftTransaction = require("../models/giftTransaction");
const trophyController = require("../controllers/trophyController");
const PKBattle = require("../models/pkBattle");

exports.addGift = async (req, res) => {
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

    const gift = await Gift.create({
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
// this for admin side to add gift and category
// exports.addCategory = async (req, res) => {
//   try {
//     const { name } = req.body;

//     // ✅ Validation
//     if (!name || !name.trim()) {
//       return res.status(400).json({
//         message: "Category name is required",
//       });
//     }

//     // ✅ Check duplicate
//     const exists = await Category.findOne({ name: name.trim() });
//     if (exists) {
//       return res.status(409).json({
//         message: "Category already exists",
//       });
//     }

//     // ✅ Create category
//     const category = await Category.create({
//       name: name.trim(),
//     });

//     return res.status(201).json({
//       message: "Category added successfully",
//       category,
//     });
//   } catch (error) {
//     console.error("Add Category Error:", error);
//     return res.status(500).json({
//       message: "Internal server error",
//     });
//   }
// };
exports.addCategory = async (req, res) => {
  try {
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Category type is required",
      });
    }

    const allowedTypes = ["HOT", "LUCKY", "SIV", "CUSTOMIZED", "BAG", "NONE"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category type",
      });
    }

    const exists = await Category.findOne({ type });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Category already exists",
      });
    }

    const category = await Category.create({
      type,
    });

    return res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("❌ Add Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.getCategory = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
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
// this for admin side to add gift and category
exports.getAllGifts = async (req, res) => {
  try {
    const gifts = await Gift.find({ isAvailable: true }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      data: gifts,
    });
  } catch (error) {
    console.error("❌ Fetch All Gifts Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching gifts",
    });
  }
};

// GET /api/store-gifts/get-gift-by-category/:category
exports.getGiftsByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    const gifts = await Gift.find({
      category: { $regex: `^${category}$`, $options: "i" }, // case-insensitive
      isAvailable: true,
    });

    return res.status(200).json({
      success: true,
      data: gifts,
    });
  } catch (error) {
    console.error("❌ Fetch Category Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching gifts category",
    });
  }
};
// this for admin side to add gift and category
exports.checkEligibility = async (req, res) => {
  try {
    const { giftId } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        eligible: false,
        message: "User not found",
      });
    }

    const gift = await Gift.findById(giftId);

    if (!gift || !gift.isAvailable) {
      return res.status(404).json({
        success: false,
        eligible: false,
        message: "Gift not available",
      });
    }

    const eligible = user.coins >= gift.price;

    return res.json({
      success: true,
      eligible,
      userCoins: user.coins,
      giftCost: gift.price,
      giftName: gift.name,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      eligible: false,
      message: "Eligibility check failed",
    });
  }
};

/**
 * 🔥 GET GIFT TRANSACTIONS IN ROOM
 */
exports.getGiftTransactions = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    const transactions = await GiftTransaction.find({ roomId })
      .populate("senderId", "username avatar")
      .populate("recipientIds", "username avatar")
      .populate("giftId", "name icon rarity")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip));

    const total = await GiftTransaction.countDocuments({ roomId });

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        limit: Number(limit),
        skip: Number(skip),
      },
    });
  } catch (error) {
    console.error("❌ getGiftTransactions error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching gift transactions",
      error: error.message,
    });
  }
};

/**
 * 🔥 GET GIFTS RECEIVED BY USER
 */
exports.getUserReceivedGifts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, skip = 0 } = req.query;

    const transactions = await GiftTransaction.find({
      recipientIds: userId,
    })
      .populate("senderId", "username avatar")
      .populate("giftId", "name icon rarity")
      .populate("roomId", "roomName")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip));

    const total = await GiftTransaction.countDocuments({
      recipientIds: userId,
    });

    // 🔥 Calculate total gifts received
    const totalCoinsReceived = transactions.reduce(
      (sum, t) => sum + t.giftPrice,
      0,
    );

    res.status(200).json({
      success: true,
      data: {
        transactions,
        summary: {
          totalGiftsReceived: transactions.length,
          totalCoinsReceived,
          pagination: {
            total,
            limit: Number(limit),
            skip: Number(skip),
          },
        },
      },
    });
  } catch (error) {
    console.error("❌ getUserReceivedGifts error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching received gifts",
      error: error.message,
    });
  }
};

/**
 * 🔥 GET GIFT ANALYTICS
 */
exports.getGiftAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;

    // Total gifts sent
    const sentGifts = await GiftTransaction.find({ senderId: userId });

    // Total coins spent
    const totalCoinsSpent = sentGifts.reduce(
      (sum, t) => sum + t.totalCoinsDeducted,
      0,
    );

    // Breakdown by sendType
    const sendTypeBreakdown = {
      individual: sentGifts.filter((g) => g.sendType === "individual").length,
      all_in_room: sentGifts.filter((g) => g.sendType === "all_in_room").length,
      all_on_mic: sentGifts.filter((g) => g.sendType === "all_on_mic").length,
    };

    // Most sent gift
    const giftCounts = {};
    sentGifts.forEach((t) => {
      giftCounts[t.giftName] = (giftCounts[t.giftName] || 0) + 1;
    });

    const mostSentGift =
      Object.keys(giftCounts).length > 0
        ? Object.entries(giftCounts).sort((a, b) => b[1] - a[1])[0]
        : null;

    res.status(200).json({
      success: true,
      data: {
        totalGiftsSent: sentGifts.length,
        totalCoinsSpent,
        sendTypeBreakdown,
        mostSentGift: mostSentGift
          ? {
              name: mostSentGift[0],
              count: mostSentGift[1],
            }
          : null,
      },
    });
  } catch (error) {
    console.error("❌ getGiftAnalytics error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching analytics",
      error: error.message,
    });
  }
};
