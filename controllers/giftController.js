const cloudinary = require("../config/cloudinary");
const User = require("../models/users");
const Category = require("../models/category");
const Room = require("../models/room");
const Gift = require("../models/gifts");

exports.addGift = async (req, res) => {
  try {
    const { name, price, category } = req.body;

    // ❌ Validation
    if (!name || !price || !category || !req.file) {
      return res.status(400).json({
        success: false,
        message: "Name, price, category and image are required",
      });
    }

    // ✅ Upload image to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: "gifts",
      resource_type: "image",
    });

    // ✅ Save gift
    const gift = await Gift.create({
      name,
      price,
      category,

      // 🔥 IMPORTANT PART
      giftImage: uploadResult.secure_url, // ✅ MAIN IMAGE
      cloudinaryId: uploadResult.public_id,

      mediaType: uploadResult.format === "gif" ? "gif" : "image",
    });

    return res.status(201).json({
      success: true,
      message: "Gift added successfully",
      gift,
    });
  } catch (error) {
    console.error("Add Gift Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { name } = req.body;

    // ✅ Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    // ✅ Check duplicate
    const exists = await Category.findOne({ name: name.trim() });
    if (exists) {
      return res.status(409).json({
        message: "Category already exists",
      });
    }

    // ✅ Create category
    const category = await Category.create({
      name: name.trim(),
    });

    return res.status(201).json({
      message: "Category added successfully",
      category,
    });
  } catch (error) {
    console.error("Add Category Error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
exports.getCategory = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 }); // ✅ OLD → NEW (new data at bottom)

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

exports.getAllGifts = async (req, res) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;

    let query = { isActive: true }; // ✅ FIXED

    if (category) {
      query.category = category;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const gifts = await Gift.find(query)
      .sort({ createdAt: -1 }) // rarity sort optional
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Gift.countDocuments(query);

    res.status(200).json({
      success: true,
      gifts,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get All Gifts Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gifts",
    });
  }
};
exports.checkEligibility = async (req, res) => {
  try {
    const { giftId, recipientId } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", eligible: false });
    }

    const gift = await Gift.findOne({ giftId, isActive: true });
    if (!gift) {
      return res
        .status(404)
        .json({ success: false, message: "Gift not found", eligible: false });
    }

    const eligible = user.coinBalance >= gift.coinCost;

    return res.json({
      success: true,
      eligible,
      userCoins: user.coinBalance,
      giftCost: gift.coinCost,
      giftName: gift.giftName,
      message: eligible
        ? "Sufficient balance"
        : `Need ${gift.coinCost - user.coinBalance} more coins`,
    });
  } catch (error) {
    next(error);
  }
};

exports.sendGift = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { giftId, sendTo } = req.body;

    if (!["ALL_ROOM", "ALL_MIC"].includes(sendTo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sendTo value",
      });
    }

    // 🔐 FETCH GIFT (PRICE & IMAGE FROM DB)
    const gift = await Gift.findById(giftId);
    if (!gift || !gift.isAvailable) {
      return res.status(404).json({
        success: false,
        message: "Gift not available",
      });
    }

    // 🎯 COLLECT RECEIVERS
    const receivers = [];
    connectedUsers.forEach((data, userId) => {
      if (userId === senderId) return;

      if (sendTo === "ALL_ROOM") receivers.push(userId);
      if (sendTo === "ALL_MIC" && data.isOnMic) receivers.push(userId);
    });

    if (!receivers.length) {
      return res.status(400).json({
        success: false,
        message: "No users available",
      });
    }

    const totalCost = gift.price * receivers.length;

    const sender = await User.findById(senderId);
    if (!sender || sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coins",
      });
    }

    // 🔻 DEDUCT COINS
    sender.coins -= totalCost;
    await sender.save();

    // 🧾 SAVE TRANSACTIONS
    await GiftTransaction.insertMany(
      receivers.map((receiverId) => ({
        senderId,
        receiverId,
        giftId: gift._id,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        giftCategory: gift.category,
        giftRarity: gift.rarity,
      }))
    );

    return res.json({
      success: true,
      sentTo: receivers.length,
      coinsDeducted: totalCost,
      gift: {
        icon: gift.icon,
        price: gift.price,
        rarity: gift.rarity,
      },
    });
  } catch (error) {
    console.error("SEND GIFT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
