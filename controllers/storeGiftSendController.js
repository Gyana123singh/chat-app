const mongoose = require("mongoose");
const StoreGift = require("../models/storeGift");
const StoreGiftInventory = require("../models/storeGiftInventory");
const GiftTransaction = require("../models/giftTransaction");
const User = require("../models/users");

// ===============================
// 🎁 BUY / SEND GIFT
// ===============================
exports.sendGift = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const senderId = req.user.userId;
    const {
      giftId,
      receiverIds,
      roomId,
      quantity = 1,
      duration = 1,
    } = req.body;

    if (!giftId || !Array.isArray(receiverIds) || receiverIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payload" });
    }

    if (quantity < 1 || duration < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid quantity or duration" });
    }

    const gift = await StoreGift.findById(giftId);
    const sender = await User.findById(senderId);

    if (!gift || !sender) {
      return res
        .status(404)
        .json({ success: false, message: "Gift or sender not found" });
    }

    // ❌ Prevent sending to self
    const filteredReceivers = receiverIds.filter(
      (id) => id.toString() !== senderId.toString(),
    );

    if (filteredReceivers.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot send gift to yourself" });
    }

    const totalCost = gift.price * quantity * filteredReceivers.length;

    if (sender.coins < totalCost) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient coins" });
    }

    session.startTransaction();

    // 💰 Deduct coins
    sender.coins -= totalCost;
    sender.totalSpent += totalCost;
    await sender.save({ session });

    const expiresAt =
      gift.effectType !== "NONE"
        ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
        : null;

    // 🔁 Deactivate previous active gifts of same type (WAFA behavior)
    if (gift.effectType !== "NONE") {
      await StoreGiftInventory.updateMany(
        {
          userId: { $in: filteredReceivers },
          effectType: gift.effectType,
          isActive: true,
        },
        { $set: { isActive: false } },
        { session },
      );
    }

    // 📦 Add gift to receivers inventory (as active)
    const inventories = filteredReceivers.map((rid) => ({
      userId: rid,
      giftId: gift._id,
      effectType: gift.effectType,
      icon: gift.icon,
      animationUrl: gift.animationUrl,
      duration,
      expiresAt,
      isActive: true,
    }));

    await StoreGiftInventory.insertMany(inventories, { session });

    // 🎯 Apply effect to user profile (ATTACH TO PROFILE)
    for (const rid of filteredReceivers) {
      const update = {};

      if (gift.effectType === "FRAME") update["profile.frame"] = gift.icon;
      if (gift.effectType === "RING") update["profile.ring"] = gift.icon;
      if (gift.effectType === "BUBBLE") update["profile.bubble"] = gift.icon;
      if (gift.effectType === "ENTRANCE")
        update["profile.entranceEffect"] = gift.animationUrl;
      if (gift.effectType === "THEME")
        update["profile.theme"] = gift.name.toLowerCase();

      if (Object.keys(update).length > 0) {
        await User.findByIdAndUpdate(rid, { $set: update }, { session });
      }
    }

    // 🧾 Save transaction
    await GiftTransaction.create(
      [
        {
          senderId,
          giftId: gift._id,
          giftName: gift.name,
          giftIcon: gift.icon,
          giftPrice: gift.price,
          giftCategory: gift.category,
          giftRarity: gift.rarity,
          sendType: roomId ? "all_in_room" : "individual",
          recipientIds: filteredReceivers,
          recipientCount: filteredReceivers.length,
          totalCoinsDeducted: totalCost,
          quantity,
          status: "completed",
          roomIdString: roomId || null,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    // 🔔 SOCKET EMIT
    const io = req.app.get("io");

    const payload = {
      giftId: gift._id,
      name: gift.name,
      icon: gift.icon,
      animationUrl: gift.animationUrl,
      effectType: gift.effectType,
      duration,
      sender: {
        id: sender._id,
        username: sender.username,
        avatar: sender.profile.avatar,
      },
    };

    // Send animation to each receiver
    filteredReceivers.forEach((rid) => {
      io.to(rid.toString()).emit("gift:received", payload);
    });

    // Entrance broadcast to room
    if (roomId && gift.effectType === "ENTRANCE") {
      io.to(`room:${roomId}`).emit("room:entranceEffect", {
        userIds: filteredReceivers,
        animationUrl: gift.animationUrl,
      });
    }

    return res.json({
      success: true,
      message: "Gift sent and applied successfully",
      senderCoinsRemaining: sender.coins,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};
