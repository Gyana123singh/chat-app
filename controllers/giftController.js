const cloudinary = require("../config/cloudinary");
const User = require("../models/users");
const Category = require("../models/category");
const Room = require("../models/room");
const Gift = require("../models/gifts");
const GiftTransaction = require("../models/giftTransaction");
const StoreGiftTransaction = require("../models/storeGiftTransaction");
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
      .populate("senderId", "username profile.avatar")
      .populate("recipientIds", "username profile.avatar")
      .populate("giftId", "name icon rarity")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip))
      .lean();

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
      .populate("senderId", "username profile.avatar")
      .populate("giftId", "name icon rarity")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip))
      .lean();

    const total = await GiftTransaction.countDocuments({
      recipientIds: userId,
    });

    // 🔥 CORRECT MULTIPLIER CALCULATION
    const totalCoinsReceived = transactions.reduce(
      (sum, t) => sum + t.giftPrice * (t.quantity || 1),
      0,
    );

    const totalGiftsReceived = transactions.reduce(
      (sum, t) => sum + (t.quantity || 1),
      0,
    );

    res.status(200).json({
      success: true,
      data: {
        transactions,
        summary: {
          totalGiftsReceived,
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

const STORE_EFFECT_TYPES = ["ENTRANCE", "FRAME", "RING", "BUBBLE", "THEME", "EMOJI"];

function isStoreGiftTx(tx) {
  if (!tx) return true;

  const effect = ((tx.giftId && tx.giftId.effectType) || tx.effectType || "").toUpperCase();
  if (effect && STORE_EFFECT_TYPES.includes(effect)) return true;

  return false;
}

/**
 * 🔥 GET GIFT WALL (SENT & RECEIVED BY SPECIFIC USER - EXCLUDES STORE ITEMS)
 */
exports.getGiftWall = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type = "all", limit = 50, skip = 0 } = req.query;

    // Fetch both sent & received to filter store items and calculate exact counts
    const [allSent, allReceived] = await Promise.all([
      GiftTransaction.find({ senderId: userId })
        .populate("senderId", "username profile.avatar displayId level")
        .populate("recipientIds", "username profile.avatar displayId level")
        .populate("giftId", "name icon rarity price category effectType")
        .sort({ createdAt: -1 })
        .lean(),
      GiftTransaction.find({ recipientIds: userId })
        .populate("senderId", "username profile.avatar displayId level")
        .populate("recipientIds", "username profile.avatar displayId level")
        .populate("giftId", "name icon rarity price category effectType")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const validSent = allSent.filter((tx) => !isStoreGiftTx(tx));
    const validReceived = allReceived.filter((tx) => !isStoreGiftTx(tx));

    let selectedList;
    if (type === "sent") {
      selectedList = validSent;
    } else if (type === "received") {
      selectedList = validReceived;
    } else {
      const combinedMap = new Map();
      [...validReceived, ...validSent].forEach((tx) => {
        if (tx && tx._id) {
          combinedMap.set(tx._id.toString(), tx);
        }
      });
      selectedList = Array.from(combinedMap.values()).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
    }

    const paginated = selectedList.slice(Number(skip), Number(skip) + Number(limit));

    res.status(200).json({
      success: true,
      data: {
        transactions: paginated,
        summary: {
          totalSentGifts: validSent.length,
          totalReceivedGifts: validReceived.length,
          totalGifts: selectedList.length,
        },
        pagination: {
          total: selectedList.length,
          limit: Number(limit),
          skip: Number(skip),
        },
      },
    });
  } catch (error) {
    console.error("❌ getGiftWall error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching gift wall",
    });
  }
};
/**
 * 🔥 GET SENT GIFT HISTORY (DETAILED)
 */
exports.getSentGiftHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, skip = 0 } = req.query;

    const [transactions1, transactions2] = await Promise.all([
      GiftTransaction.find({ senderId: userId })
        .populate("recipientIds", "username profile.avatar displayId")
        .populate("giftId", "name icon rarity price")
        .sort({ createdAt: -1 })
        .lean(),
      StoreGiftTransaction.find({ senderId: userId })
        .populate("receiverIds", "username profile.avatar displayId")
        .populate("giftId", "name icon rarity price")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // Normalize
    const normalized2 = transactions2.map((t) => ({
      ...t,
      recipientIds: t.receiverIds,
      quantity: t.quantitySent || 1,
      type: "store",
    }));

    const normalized1 = transactions1.map((t) => ({
      ...t,
      type: "room",
    }));

    const allTransactions = [...normalized1, ...normalized2].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    const paginated = allTransactions.slice(
      Number(skip),
      Number(skip) + Number(limit),
    );

    res.status(200).json({
      success: true,
      history: paginated,
      total: allTransactions.length,
      limit: Number(limit),
      skip: Number(skip),
    });
  } catch (error) {
    console.error("❌ getSentGiftHistory error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching gift history",
    });
  }
};
