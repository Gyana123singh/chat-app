const mongoose = require("mongoose");
const StoreGift = require("../models/storeGift");
const StoreGiftInventory = require("../models/storeGiftInventory");
const GiftTransaction = require("../models/giftTransaction");
const User = require("../models/users");
const trophyController = require("./trophyController");

// ===============================
// 🎁 BUY / SEND GIFT
// ===============================
exports.sendGift = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const senderId = req.user.id;
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
      if (gift.effectType === "THEME") {
        const themeUrl = gift.animationUrl || gift.icon;
        const themeName = gift.name.toLowerCase();
        update["profile.theme"] = themeName;
        update["profile.themeUrl"] = themeUrl;

        const Room = require("../models/room");
        await Room.updateMany(
          { $or: [{ host: rid }, { creator: rid }] },
          { $set: { hostThemeUrl: themeUrl, theme: themeName } },
          { session }
        );
      }

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
      theme: gift.effectType === "THEME" ? gift.name.toLowerCase() : null,
      themeUrl: gift.effectType === "THEME" ? gift.animationUrl || gift.icon : null,
      sender: {
        id: sender._id,
        username: sender.username,
        avatar: sender.profile.avatar,
      },
    };

    // Send animation to each receiver
    filteredReceivers.forEach((rid) => {
      io.to(rid.toString()).emit("gift:received", payload);
      io.to(rid.toString()).emit("profile:update", {
        effectType: gift.effectType,
        theme: gift.effectType === "THEME" ? gift.name.toLowerCase() : null,
        themeUrl: gift.effectType === "THEME" ? gift.animationUrl || gift.icon : null,
      });
    });

    // Room broadcast and notification
    if (roomId) {
      const recipientsList = await User.find({ _id: { $in: filteredReceivers } })
        .select("username profile.avatar displayId")
        .lean();

      const recipients = recipientsList.map(r => ({
        userId: r._id,
        username: r.username,
        avatar: r.profile?.avatar,
        displayId: r.displayId
      }));

      io.to(`room:${roomId}`).emit("gift:received", {
        fromUserId: senderId,
        fromDisplayId: sender.displayId,
        fromUsername: sender.username,
        fromAvatar: sender.profile?.avatar || null,
        recipientIds: filteredReceivers,
        recipients,
        gift: {
          _id: gift._id,
          name: gift.name,
          icon: gift.icon,
          animationUrl: gift.animationUrl || gift.icon,
          price: gift.price,
          rarity: gift.rarity,
          effectType: gift.effectType,
        },
        quantity,
        sendType: "all_in_room"
      });

      io.to(`room:${roomId}`).emit("gift:notification", {
        fromUserId: senderId,
        fromUsername: sender.username,
        fromAvatar: sender.profile?.avatar || null,
        fromDisplayId: sender.displayId,
        recipients,
        gift: {
          _id: gift._id,
          name: gift.name,
          icon: gift.icon,
          animationUrl: gift.animationUrl || gift.icon,
          price: gift.price,
        },
        quantity,
        text: `${sender.username} sent ${gift.name} x${quantity} to ${recipients.map(r => r.username).join(", ")}`
      });

      // Entrance broadcast to room
      if (gift.effectType === "ENTRANCE") {
        io.to(`room:${roomId}`).emit("room:entranceEffect", {
          userIds: filteredReceivers,
          animationUrl: gift.animationUrl,
        });
      }
    }

    // Room theme broadcast for all rooms owned by receivers
    if (gift.effectType === "THEME") {
      const Room = require("../models/room");
      const themeUrl = gift.animationUrl || gift.icon;
      const themeName = gift.name.toLowerCase();

      for (const rid of filteredReceivers) {
        const userRooms = await Room.find({ $or: [{ host: rid }, { creator: rid }] }).select("roomId").lean();
        for (const ur of userRooms) {
          io.to(`room:${ur.roomId}`).emit("room:theme:update", {
            theme: themeName,
            themeUrl: themeUrl,
            triggeredBy: senderId,
          });
        }
      }
    }

    // 🏆 Update Leaderboard
    await trophyController.updateLeaderboardOnGift(senderId, totalCost);

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
