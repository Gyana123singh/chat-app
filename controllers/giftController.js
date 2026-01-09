const cloudinary = require("../config/cloudinary");
const User = require("../models/users");
const Category = require("../models/category");
const Room = require("../models/room");
const Gift = require("../models/gifts");
const GiftTransaction = require("../models/giftTransaction");

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

/**
 * 🔥 SEND GIFT - Main function
 * Handles: Individual, All in Room, All on Mic
 */
exports.sendGift = async (req, res) => {
  try {
    const senderId = req.user.id; // From auth middleware
    const {
      roomId,
      giftId,
      recipients, // [userId1, userId2, ...] for individual
      sendType, // "individual", "all_in_room", "all_on_mic"
      micOnlineUsers, // { userId: { muted, speaking } } from socket
    } = req.body;

    // ✅ Validation
    if (!roomId || !giftId || !sendType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: roomId, giftId, sendType",
      });
    }

    if (!["individual", "all_in_room", "all_on_mic"].includes(sendType)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid sendType. Must be individual, all_in_room, or all_on_mic",
      });
    }

    // ✅ Get sender
    const sender = await User.findById(senderId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    // ✅ Get gift
    const gift = await Gift.findById(giftId);
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    if (!gift.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "Gift is not available",
      });
    }

    // ✅ Get room
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // ✅ Determine recipients based on sendType
    let finalRecipients = [];

    if (sendType === "individual") {
      if (
        !recipients ||
        !Array.isArray(recipients) ||
        recipients.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Recipients array required for individual send",
        });
      }
      finalRecipients = recipients;
    } else if (sendType === "all_in_room") {
      if (!Array.isArray(micOnlineUsers) || micOnlineUsers.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No users in room",
        });
      }
      finalRecipients = micOnlineUsers;
    } else if (sendType === "all_on_mic") {
      if (!Array.isArray(micOnlineUsers) || micOnlineUsers.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No users on mic",
        });
      }
      // 🔥 Filter only users who are currently speaking (on mic)
      finalRecipients = micOnlineUsers.filter(
        (userId) => req.body.micStatus && req.body.micStatus[userId]?.speaking
      );

      if (finalRecipients.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No users currently on mic",
        });
      }
    }

    // ✅ Remove sender from recipients (can't send to self)
    finalRecipients = finalRecipients.filter(
      (recipientId) => recipientId.toString() !== senderId.toString()
    );

    if (finalRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid recipients found",
      });
    }

    // ✅ Calculate total cost
    const recipientCount = finalRecipients.length;
    const totalCoinsRequired = gift.price * recipientCount;

    // ✅ Check sender's balance
    if (sender.coins < totalCoinsRequired) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCoinsRequired}, Available: ${sender.coins}`,
        required: totalCoinsRequired,
        available: sender.coins,
      });
    }

    // ✅ Start transaction - deduct from sender
    sender.coins -= totalCoinsRequired;
    await sender.save();

    // ✅ Add coins to each recipient
    const recipientUpdateResults = await Promise.allSettled(
      finalRecipients.map(async (recipientId) => {
        const recipient = await User.findById(recipientId);
        if (recipient) {
          recipient.coins += gift.price;
          await recipient.save();
          return recipient;
        }
        return null;
      })
    );

    // ✅ Track successful updates
    const successfulRecipients = recipientUpdateResults
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value._id);

    // ✅ Create gift transaction record
    const transaction = await GiftTransaction.create({
      roomId,
      senderId,
      receiverId: finalRecipients[0], // Primary recipient (for display)
      giftId,
      giftName: gift.name,
      giftIcon: gift.icon,
      giftPrice: gift.price,
      giftCategory: gift.category,
      giftRarity: gift.rarity,
      sendType,
      totalCoinsDeducted: totalCoinsRequired,
      recipientCount: successfulRecipients.length,
      recipientIds: successfulRecipients,
      status: "completed",
    });

    // ✅ Response
    res.status(200).json({
      success: true,
      message: `Gift sent successfully to ${successfulRecipients.length} recipient(s)`,
      data: {
        transactionId: transaction._id,
        giftName: gift.name,
        giftIcon: gift.icon,
        sendType,
        recipientCount: successfulRecipients.length,
        coinsPerRecipient: gift.price,
        totalCoinsDeducted: totalCoinsRequired,
        senderNewBalance: sender.coins,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("❌ sendGift error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error sending gift",
      error: error.message,
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
      .populate("receiverId", "username avatar")
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
      0
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
      0
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
