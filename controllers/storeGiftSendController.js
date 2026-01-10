const GiftTransaction = require("../models/storeGiftTransaction");
const Gift = require("../models/storeGift");
const User = require("../models/users");
const UserGift = require("../models/userStoreGift");
const { io } = require("../server"); // Socket.IO instance

// Get friends list for sending gifts
exports.getFriendsForGift = async (req, res) => {
  try {
    const { userId } = req.user; // From auth middleware
    const { search = "", skip = 0, limit = 50 } = req.query;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get following list (friends who user follows)
    let query = {};

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { diiId: { $regex: search, $options: "i" } },
      ];
    }

    const friends = await User.find(query)
      .select("_id username diiId profile.avatar")
      .skip(parseInt(skip))
      .limit(parseInt(limit));

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

// Send gift to single user
exports.sendGiftToUser = async (req, res) => {
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

    // Get sender (current user)
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    // Calculate total cost
    const totalCost = gift.price * quantity;

    // Check if sender has enough coins
    if (sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCost}, Available: ${sender.coins}`,
      });
    }

    // Start transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Deduct coins from sender
      sender.coins -= totalCost;
      await sender.save({ session });

      // Add coins to receiver (optional - depends on your business logic)
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

      // Create user gift record (for receiver's collection)
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

      // Emit socket event for real-time notification
      io.to(receiverId.toString()).emit("giftReceived", {
        senderId: userId,
        senderName: sender.username,
        senderAvatar: sender.profile.avatar,
        giftName: gift.name,
        giftIcon: gift.icon,
        quantity: quantity,
        message: `${sender.username} sent you ${gift.name}!`,
      });

      return res.status(200).json({
        success: true,
        message: "Gift sent successfully",
        data: {
          transaction: transaction._id,
          senderCoinsRemaining: sender.coins,
          receiverGiftsCount: receiver.stats.giftsReceived,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending gift",
      error: error.message,
    });
  }
};

// Send gift to multiple users
exports.sendGiftToMultipleUsers = async (req, res) => {
  try {
    const { userId } = req.user;
    const { giftId, receiverIds, quantity = 1 } = req.body;

    if (!giftId || !receiverIds || receiverIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing giftId or receiverIds",
      });
    }

    const gift = await Gift.findById(giftId);
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    const totalCost = gift.price * quantity * receiverIds.length;

    if (sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCost}, Available: ${sender.coins}`,
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Deduct coins
      sender.coins -= totalCost;
      await sender.save({ session });

      // Update each receiver
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

      // Create user gift records for all receivers
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

      // Emit socket event to all receivers
      receiverIds.forEach((receiverId) => {
        io.to(receiverId.toString()).emit("giftReceived", {
          senderId: userId,
          senderName: sender.username,
          senderAvatar: sender.profile.avatar,
          giftName: gift.name,
          giftIcon: gift.icon,
          quantity: quantity,
          message: `${sender.username} sent you ${gift.name}!`,
        });
      });

      return res.status(200).json({
        success: true,
        message: "Gift sent to all users successfully",
        data: {
          transaction: transaction._id,
          senderCoinsRemaining: sender.coins,
          totalReceivers: receiverIds.length,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending gift",
      error: error.message,
    });
  }
};

// Send gift to all in room
exports.sendGiftToRoom = async (req, res) => {
  try {
    const { userId } = req.user;
    const { giftId, roomId, sendType, quantity = 1 } = req.body;

    if (!giftId || !roomId) {
      return res.status(400).json({
        success: false,
        message: "Missing giftId or roomId",
      });
    }

    const gift = await Gift.findById(giftId);
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    const room = await Room.findById(roomId).populate("participants.user");
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const sender = await User.findById(userId);

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
        message: "No recipients found",
      });
    }

    const totalCost = gift.price * quantity * receiverIds.length;

    if (sender.coins < totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins. Required: ${totalCost}, Available: ${sender.coins}`,
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      sender.coins -= totalCost;
      await sender.save({ session });

      const receivers = await User.find({ _id: { $in: receiverIds } }).session(
        session
      );

      for (let receiver of receivers) {
        receiver.stats.giftsReceived += quantity;
        await receiver.save({ session });
      }

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

      // Notify all receivers in room via socket
      receiverIds.forEach((receiverId) => {
        io.to(receiverId.toString()).emit("giftReceived", {
          senderId: userId,
          senderName: sender.username,
          senderAvatar: sender.profile.avatar,
          giftName: gift.name,
          giftIcon: gift.icon,
          quantity: quantity,
          roomId: roomId,
          message: `${sender.username} sent you ${gift.name}!`,
        });
      });

      return res.status(200).json({
        success: true,
        message: "Gift sent to room successfully",
        data: {
          transaction: transaction._id,
          senderCoinsRemaining: sender.coins,
          totalReceivers: receiverIds.length,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending gift to room",
      error: error.message,
    });
  }
};

// Get user's received gifts
exports.getUserGifts = async (req, res) => {
  try {
    const { userId } = req.user;
    const { skip = 0, limit = 20 } = req.query;

    const gifts = await UserGift.find({ userId })
      .populate("giftId")
      .populate("receivedFrom", "username profile.avatar")
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
      .populate("senderId", "username profile.avatar")
      .populate("receiverIds", "username profile.avatar")
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
