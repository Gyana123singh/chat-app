const cloudinary = require("../config/cloudinary");
const User = require("../models/users");
const Category = require("../models/category");
const Room = require("../models/room");
const Gift = require("../models/gifts");
const GiftTransaction = require("../models/giftTransaction");
const trophyController = require("../controllers/trophyController");
const { getIO } = require("../utils/socketService");
const mongoose = require("mongoose");

// this for admin side to add gift and category
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
      icon: uploadResult.secure_url, // ✅ MAIN IMAGE
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
// this for admin side to add gift and category
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
// this for admin side to add gift and category
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

// this for admin side to add gift and category
exports.getAllGifts = async (req, res) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;

    // ✅ FIX 1: correct field name
    let query = { isAvailable: true };

    // ✅ FIX 2: category filter
    if (category) {
      query.category = category;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ✅ FIX 3: populate category name
    const gifts = await Gift.find(query)
      .populate("category", "name") // 🔥 IMPORTANT
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Gift.countDocuments(query);

    return res.status(200).json({
      success: true,
      gifts,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Get All Gifts Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch gifts",
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

// ..........................................................
// this is for user side to send gift

/**
 * 🔥 SEND GIFT - Main function (UPDATED WITH TROPHY INTEGRATION & ERROR HANDLING)
 * Handles: Individual, All in Room, All on Mic
 */

// 🎁 SEND GIFT (NO PK)

exports.sendGift = async (req, res) => {
  try {
    const senderId = req.user.id;
    const {
      roomId,
      giftId,
      recipients = [],
      sendType,
      micOnlineUsers = [],
      micStatus = {},
    } = req.body;

    if (!roomId || !giftId || !sendType) {
      return res.status(400).json({
        success: false,
        message: "roomId, giftId and sendType required",
      });
    }

    const sender = await User.findById(senderId);
    const gift = await Gift.findById(giftId);
    const room = await Room.findOne({ roomId });

    if (!sender || !gift || !room) {
      return res.status(404).json({
        success: false,
        message: "Invalid data",
      });
    }

    // 🎯 recipients logic
    let finalRecipients = [];

    if (sendType === "individual") finalRecipients = recipients;

    if (sendType === "all_in_room") finalRecipients = micOnlineUsers;

    if (sendType === "all_on_mic")
      finalRecipients = micOnlineUsers.filter(
        (uid) => micStatus?.[uid]?.speaking === true,
      );

    finalRecipients = finalRecipients.filter(
      (id) => id.toString() !== senderId.toString(),
    );

    if (!finalRecipients.length) {
      return res.status(400).json({
        success: false,
        message: "No valid recipients",
      });
    }

    const totalCoins = gift.price * finalRecipients.length;

    if (sender.coins < totalCoins) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coin",
      });
    }

    // 💰 deduct coins
    sender.coins -= totalCoins;
    sender.totalSpent += totalCoins;
    await sender.save();

    // 🧾 transaction
    const transaction = await GiftTransaction.create({
      roomId,
      senderId,
      giftId,
      recipientIds: finalRecipients,
      recipientCount: finalRecipients.length,
      giftName: gift.name,
      giftIcon: gift.icon,
      giftPrice: gift.price,
      category: gift.category,
      giftRarity: gift.rarity,
      sendType,
      totalCoinsDeducted: totalCoins,
      status: "completed",
    });

    // 🔥 DEBUG LOGGING
    console.log("📊 Before User Update:", {
      finalRecipientsCount: finalRecipients.length,
      giftPrice: gift.price,
      totalCoins: totalCoins,
      sampleRecipient: finalRecipients[0],
      recipientType: typeof finalRecipients[0],
    });

    // ✅ FIXED: Added 'new' keyword for ObjectId constructor
    const recipientObjectIds = finalRecipients
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch (e) {
          console.log("Invalid ObjectId:", id, e.message);
          return null;
        }
      })
      .filter(Boolean);

    if (recipientObjectIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid recipient IDs format",
      });
    }

    try {
      await User.updateMany(
        { _id: { $in: recipientObjectIds } },
        {
          $inc: {
            "stats.giftsReceived": 1,
            totalEarned: gift.price,
          },
        },
      );
      console.log("✅ User update successful");
    } catch (updateErr) {
      console.error("❌ User update error:", updateErr);
      throw updateErr;
    }

    const io = getIO();

    // 🎬 gift animation
    io.to(`room:${roomId}`).emit("gift:received", {
      senderId,
      senderUsername: sender.username,
      senderAvatar: sender.profile?.avatar,
      giftName: gift.name,
      giftIcon: gift.icon,
      giftPrice: gift.price,
      giftRarity: gift.rarity,
      sendType,
      timestamp: new Date().toISOString(),
    });

    // 🏆 leaderboard
    await trophyController.updateLeaderboardOnGift(senderId, totalCoins);

    return res.status(200).json({
      success: true,
      message: "Gift sent successfully",
      data: {
        transactionId: transaction._id,
        senderNewBalance: sender.coins,
      },
    });
  } catch (err) {
    console.error("sendGift error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send gift",
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
