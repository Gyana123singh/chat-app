const mongoose = require("mongoose");
const GiftTransaction = require("../models/storeGiftTransaction");
const Gift = require("../models/storeGift");
const User = require("../models/users");
const UserGift = require("../models/userStoreGift");
const Room = require("../models/room");
const io = global.io; // Now safe to use
// Send gift to single user
exports.sendGiftToUser = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { userId } = req.user;
    const { giftId, receiverId, quantity = 1 } = req.body;

    // Validate inputs
    if (!giftId || !receiverId) {
      return res.status(400).json({
        success: false,
        message: "Missing giftId or receiverId",
      });
    }

    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    // Get gift details
    const gift = await Gift.findById(giftId);
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    // Check if receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "Receiver not found",
      });
    }

    // Get sender
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    // Calculate total cost
    const totalCost = gift.price * quantity;

    // Check coins
    if (sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCost}, Available: ${sender.coins}`,
      });
    }

    // Start transaction
    session.startTransaction();

    try {
      // Deduct coins from sender
      sender.coins -= totalCost;
      await sender.save({ session });

      // Update receiver stats
      receiver.stats.giftsReceived += quantity;
      await receiver.save({ session });

      // Create gift transaction record
      const transaction = new GiftTransaction({
        senderId: userId,
        receiverIds: [receiverId],
        giftId: giftId,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        giftCategory: gift.category,
        giftRarity: gift.rarity,
        sendType: "individual",
        quantitySent: quantity,
        totalCoinsDeducted: totalCost,
        recipientCount: 1,
        status: "completed",
        completedAt: new Date(),
      });

      await transaction.save({ session });

      // Create user gift record
      const userGift = new UserGift({
        userId: receiverId,
        giftId: giftId,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        quantity: quantity,
        receivedFrom: userId,
      });

      await userGift.save({ session });

      await session.commitTransaction();

      // 🎁 EMIT SOCKET EVENT - Direct notification to receiver
      io.emit("store:giftSend", {
        receiverId: receiverId.toString(),
        giftData: {
          name: gift.name,
          icon: gift.icon,
          price: gift.price,
          rarity: gift.rarity,
          quantity: quantity,
        },
        totalCoinsDeducted: totalCost,
        senderInfo: {
          userId: sender._id,
          username: sender.username,
          avatar: sender.profile.avatar,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Gift sent successfully",
        data: {
          transactionId: transaction._id,
          senderCoinsRemaining: sender.coins,
          receiverGiftsCount: receiver.stats.giftsReceived,
          giftInfo: {
            name: gift.name,
            icon: gift.icon,
            quantity: quantity,
          },
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending gift",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Send gift to multiple users
exports.sendGiftToMultipleUsers = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { userId } = req.user;
    const { giftId, receiverIds, quantity = 1 } = req.body;

    if (
      !giftId ||
      !receiverIds ||
      !Array.isArray(receiverIds) ||
      receiverIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid giftId or receiverIds",
      });
    }

    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    // Get gift details
    const gift = await Gift.findById(giftId);
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    // Get sender
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    // Calculate total cost
    const totalCost = gift.price * quantity * receiverIds.length;

    if (sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCost}, Available: ${sender.coins}`,
      });
    }

    // Start transaction
    session.startTransaction();

    try {
      // Deduct coins
      sender.coins -= totalCost;
      await sender.save({ session });

      // Update receivers
      const receivers = await User.find({ _id: { $in: receiverIds } }).session(
        session
      );

      for (let receiver of receivers) {
        receiver.stats.giftsReceived += quantity;
        await receiver.save({ session });
      }

      // Create transaction record
      const transaction = new GiftTransaction({
        senderId: userId,
        receiverIds: receiverIds,
        giftId: giftId,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        giftCategory: gift.category,
        giftRarity: gift.rarity,
        sendType: "individual",
        quantitySent: quantity,
        totalCoinsDeducted: totalCost,
        recipientCount: receiverIds.length,
        status: "completed",
        completedAt: new Date(),
      });

      await transaction.save({ session });

      // Create user gift records
      const userGifts = receiverIds.map((receiverId) => ({
        userId: receiverId,
        giftId: giftId,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        quantity: quantity,
        receivedFrom: userId,
      }));

      await UserGift.insertMany(userGifts, { session });

      await session.commitTransaction();

      // 🎁 EMIT SOCKET EVENT - Send to each receiver
      receiverIds.forEach((receiverId) => {
        io.emit("store:giftSend", {
          receiverId: receiverId.toString(),
          giftData: {
            name: gift.name,
            icon: gift.icon,
            price: gift.price,
            rarity: gift.rarity,
            quantity: quantity,
          },
          totalCoinsDeducted: gift.price * quantity,
          senderInfo: {
            userId: sender._id,
            username: sender.username,
            avatar: sender.profile.avatar,
          },
        });
      });

      return res.status(200).json({
        success: true,
        message: "Gift sent to all users successfully",
        data: {
          transactionId: transaction._id,
          senderCoinsRemaining: sender.coins,
          totalReceivers: receiverIds.length,
          giftInfo: {
            name: gift.name,
            icon: gift.icon,
            quantity: quantity,
          },
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending gift",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Send gift to all in room
exports.sendGiftToRoom = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { userId } = req.user;
    const { giftId, roomId, sendType = "all_in_room", quantity = 1 } = req.body;

    if (!giftId || !roomId) {
      return res.status(400).json({
        success: false,
        message: "Missing giftId or roomId",
      });
    }

    if (!["all_in_room", "all_on_mic"].includes(sendType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sendType",
      });
    }

    // Get gift
    const gift = await Gift.findById(giftId);
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    // Get room
    const room = await Room.findById(roomId).populate("participants.user");
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // Get sender
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    // Filter recipients based on sendType
    let receiverIds = [];

    if (sendType === "all_in_room") {
      receiverIds = room.participants
        .filter((p) => p.user._id.toString() !== userId)
        .map((p) => p.user._id);
    } else if (sendType === "all_on_mic") {
      receiverIds = room.participants
        .filter((p) => p.role === "host" && p.user._id.toString() !== userId)
        .map((p) => p.user._id);
    }

    if (receiverIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No recipients found in room",
      });
    }

    // Calculate cost
    const totalCost = gift.price * quantity * receiverIds.length;

    if (sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCost}, Available: ${sender.coins}`,
      });
    }

    // Start transaction
    session.startTransaction();

    try {
      // Deduct coins
      sender.coins -= totalCost;
      await sender.save({ session });

      // Update receivers
      const receivers = await User.find({ _id: { $in: receiverIds } }).session(
        session
      );

      for (let receiver of receivers) {
        receiver.stats.giftsReceived += quantity;
        await receiver.save({ session });
      }

      // Create transaction
      const transaction = new GiftTransaction({
        senderId: userId,
        receiverIds: receiverIds,
        roomId: roomId,
        giftId: giftId,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        giftCategory: gift.category,
        giftRarity: gift.rarity,
        sendType: sendType,
        quantitySent: quantity,
        totalCoinsDeducted: totalCost,
        recipientCount: receiverIds.length,
        status: "completed",
        completedAt: new Date(),
      });

      await transaction.save({ session });

      // Create user gifts
      const userGifts = receiverIds.map((receiverId) => ({
        userId: receiverId,
        giftId: giftId,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        quantity: quantity,
        receivedFrom: userId,
      }));

      await UserGift.insertMany(userGifts, { session });

      await session.commitTransaction();

      // 🎁 EMIT SOCKET EVENTS
      // 1. Send to each receiver directly
      receiverIds.forEach((receiverId) => {
        io.emit("store:giftSend", {
          receiverId: receiverId.toString(),
          giftData: {
            name: gift.name,
            icon: gift.icon,
            price: gift.price,
            rarity: gift.rarity,
            quantity: quantity,
          },
          totalCoinsDeducted: gift.price * quantity,
          senderInfo: {
            userId: sender._id,
            username: sender.username,
            avatar: sender.profile.avatar,
          },
        });
      });

      // 2. Broadcast animation to room
      io.to(`room:${roomId}`).emit("gift:roomAnimation", {
        senderId: userId,
        senderUsername: sender.username,
        senderAvatar: sender.profile.avatar,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        recipientCount: receiverIds.length,
        totalCoinsTransferred: totalCost,
        sendType: sendType,
        timestamp: new Date().toISOString(),
      });

      return res.status(200).json({
        success: true,
        message: "Gift sent to room successfully",
        data: {
          transactionId: transaction._id,
          senderCoinsRemaining: sender.coins,
          totalReceivers: receiverIds.length,
          giftInfo: {
            name: gift.name,
            icon: gift.icon,
            quantity: quantity,
            sendType: sendType,
          },
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending gift to room",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Get user's received gifts
exports.getUserGifts = async (req, res) => {
  try {
    const { userId } = req.user;
    const { skip = 0, limit = 20 } = req.query;

    const gifts = await UserGift.find({ userId })
      .populate("giftId")
      .populate("receivedFrom", "username diiId profile.avatar")
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await UserGift.countDocuments({ userId });

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
      message: "Error fetching user gifts",
      error: error.message,
    });
  }
};

// Get gift transaction history
exports.getTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.user;
    const { type = "sent", skip = 0, limit = 20 } = req.query;

    let query =
      type === "sent" ? { senderId: userId } : { receiverIds: userId };

    const transactions = await GiftTransaction.find(query)
      .populate("senderId", "username diiId profile.avatar")
      .populate("receiverIds", "username diiId profile.avatar")
      .populate("giftId")
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await GiftTransaction.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching transactions",
      error: error.message,
    });
  }
};

// Get friends list
exports.getFriendsForGift = async (req, res) => {
  try {
    const { userId } = req.user;
    const { search = "", skip = 0, limit = 50 } = req.query;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let query = {};

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { diiId: { $regex: search, $options: "i" } },
      ];
    }

    const friends = await User.find(query)
      .select("_id username diiId profile.avatar profile.bio")
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: friends,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching friends",
      error: error.message,
    });
  }
};
