const mongoose = require("mongoose");
const StoreGift = require("../models/storeGift");
const StoreGiftInventory = require("../models/storeGiftInventory");
const StoreGiftTransaction = require("../models/storeGiftTransaction");
const User = require("../models/users");
const Block = require("../models/blockUsers");
const Room = require("../models/room");
const trophyController = require("../controllers/trophyController");

module.exports = (socket, io) => {
  /* =========================================================
       🎁 SEND STORE GIFT TO ANOTHER USER
    ========================================================== */

  socket.on("store:gift:send", async (payload) => {
    try {
      const senderId = socket.data.userId;
      const senderUsername = socket.data.username;
      const senderAvatar = socket.data.avatar;

      const { giftId, receiverId, roomId = null, duration = 1 } = payload;

      if (!senderId || !giftId || !receiverId) {
        return socket.emit("store:gift:error", { message: "Missing fields" });
      }

      // ✅ BLOCK CHECK (ROOM)
      if (roomId) {
        const room = await Room.findOne({ roomId }).select("blockedUsers").lean();
        if (room?.blockedUsers?.some(id => id.toString() === senderId.toString())) {
          return socket.emit("store:gift:error", { message: "You are blocked from this room" });
        }
      }

      // ✅ BLOCK CHECK (PERSONAL MUTUAL)
      const isBlocked = await Block.findOne({
        $or: [
          { blocker: senderId, blocked: receiverId },
          { blocker: receiverId, blocked: senderId },
        ],
      }).lean();

      if (isBlocked) {
        return socket.emit("store:gift:error", {
          message: "You cannot send gifts to this user due to blocking",
        });
      }

      if (receiverId.toString() === senderId.toString()) {
        return socket.emit("store:gift:error", {
          message: "Cannot send to yourself",
        });
      }

      /* ===============================
           🎁 Find Gift
        =============================== */

      const gift = await StoreGift.findOne({
        _id: giftId,
        isAvailable: true,
      })
        .select("name icon animationUrl price category rarity effectType")
        .lean();

      console.log("🎁 Gift fetched from DB:", gift);

      if (!gift) {
        return socket.emit("store:gift:error", {
          message: "Gift not available",
        });
      }

      const receiver = await User.findById(receiverId).select("_id username profile.avatar displayId").lean();

      if (!receiver) {
        return socket.emit("store:gift:error", {
          message: "Receiver not found",
        });
      }

      /* ===============================
           💰 Deduct Coins
        =============================== */

      const sender = await User.findOneAndUpdate(
        { _id: senderId, coins: { $gte: gift.price } },
        {
          $inc: {
            coins: -gift.price,
            totalSpent: gift.price,
          },
        },
        { new: true },
      );

      if (!sender) {
        return socket.emit("store:gift:error", {
          message: "Insufficient coins",
        });
      }

      /* ===============================
           ⏳ Duration Logic
        =============================== */

      let finalDuration = duration;

      if (gift.effectType === "ENTRANCE" || gift.effectType === "FRAME") {
        finalDuration = 3;
      }

      const expiresAt = new Date(Date.now() + finalDuration * 86400000);

      /* ===============================
           🧹 Disable previous same effect
        =============================== */

      if (gift.effectType !== "NONE") {
        await StoreGiftInventory.updateMany(
          {
            userId: receiverId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
        );
      }

      /* ===============================
           📦 Add Inventory
        =============================== */

      console.log("📦 Saving inventory gift:", {
        giftId: gift._id,
        animationUrl: gift.animationUrl || gift.icon,
      });

      await StoreGiftInventory.create({
        userId: receiverId,
        giftId: gift._id,
        effectType: gift.effectType,
        icon: gift.icon,
        animationUrl: gift.animationUrl || gift.icon,
        duration: finalDuration,
        expiresAt,
        isActive: true,
      });

      /* ===============================
           👤 Apply Profile Effect
        =============================== */
      const update = {};

      if (gift.effectType === "FRAME") {
        update["profile.frame"] = {
          icon: gift.icon,
          expiresAt: expiresAt,
        };
      }

      if (gift.effectType === "RING") {
        update["profile.ring"] = gift.icon;
      }

      if (gift.effectType === "BUBBLE") {
        update["profile.bubble"] = gift.icon;
      }

      if (gift.effectType === "ENTRANCE") {
        update["profile.entranceEffect"] = gift.animationUrl || gift.icon;
      }

      if (gift.effectType === "THEME") {
        update["profile.theme"] = gift.name.toLowerCase();
      }

      if (Object.keys(update).length > 0) {
        await User.findByIdAndUpdate(receiverId, { $set: update });

        /* ===============================
   🔥 UPDATE SOCKET PROFILE CACHE
================================ */

        const receiverSockets = await io
          .in(receiverId.toString())
          .fetchSockets();

        receiverSockets.forEach((s) => {
          if (!s.data.profile) s.data.profile = {};

          if (gift.effectType === "BUBBLE") {
            s.data.profile.bubble = gift.icon;
          }

          if (gift.effectType === "FRAME") {
            s.data.profile.frame = gift.icon;
          }
        });

        /* ===============================
     🔔 GLOBAL PROFILE UPDATE
  =============================== */

        io.to(receiverId.toString()).emit("profile:update", {
          effectType: gift.effectType,
          frame:
            gift.effectType === "FRAME"
              ? {
                icon: gift.icon,
                expiresAt,
              }
              : null,
          ring: gift.effectType === "RING" ? gift.icon : null,
          bubble: gift.effectType === "BUBBLE" ? gift.icon : null,
          entranceEffect:
            gift.effectType === "ENTRANCE"
              ? gift.animationUrl || gift.icon
              : null,
          theme: gift.effectType === "THEME" ? gift.name.toLowerCase() : null,
        });
      }

      // 🔥 Notify room about new frame
      if (gift.effectType === "FRAME" && roomId) {
        io.to(`room:${roomId}`).emit("user:frame:update", {
          userId: receiverId,
          frame: {
            icon: gift.icon,
            expiresAt,
          },
        });
      }
      // 🔥 Notify room theme change
      if (gift.effectType === "THEME" && roomId) {
        io.to(`room:${roomId}`).emit("room:theme:update", {
          theme: gift.name.toLowerCase(),
          triggeredBy: senderId,
        });
      }
      /* ===============================
           🧾 Save Transaction
        =============================== */

      await StoreGiftTransaction.create({
        senderId,
        receiverIds: [receiverId],
        giftId: gift._id,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        giftCategory: gift.category,
        giftRarity: gift.rarity,
        quantitySent: 1,
        totalCoinsDeducted: gift.price,
        recipientCount: 1,
        status: "completed",
        completedAt: new Date(),
      });

      /* ===============================
           🎬 BROADCAST GIFT ANIMATION
        =============================== */

      if (roomId) {
        const payload = {
          type: "GIFT",
          fromUserId: senderId,
          fromUsername: senderUsername || "User",
          fromAvatar: senderAvatar || null,
          toUserId: receiverId,
          giftId: gift._id,
          name: gift.name,
          icon: gift.icon,
          animationUrl: gift.animationUrl || gift.icon,
          rarity: gift.rarity,
          duration: finalDuration,
        };

        console.log("🚀 Gift payload:", payload);

        io.to(`room:${roomId}`).emit("room:effect", payload);

        // Populate recipients for gift:received compatibility
        const recipients = receiver ? [{
          userId: receiver._id,
          username: receiver.username,
          avatar: receiver.profile?.avatar,
          displayId: receiver.displayId
        }] : [];

        io.to(`room:${roomId}`).emit("gift:received", {
          ...payload,
          recipientIds: [receiverId],
          recipients,
          quantity: 1,
          sendType: "individual"
        });

        // 🔔 Broad-cast simple notification details
        io.to(`room:${roomId}`).emit("gift:notification", {
          fromUserId: senderId,
          fromUsername: senderUsername || "User",
          fromAvatar: senderAvatar || null,
          fromDisplayId: sender ? sender.displayId : null,
          recipients,
          gift: {
            _id: gift._id,
            name: gift.name,
            icon: gift.icon,
            animationUrl: gift.animationUrl || gift.icon,
            price: gift.price,
          },
          quantity: 1,
          text: `${senderUsername || "User"} sent ${gift.name} x1 to ${receiver ? receiver.username : "User"}`
        });
      }

      /* ===============================
           📩 Notify Receiver
        =============================== */

      io.to(receiverId.toString()).emit("store:gift:received", {
        giftId: gift._id,
        name: gift.name,
        icon: gift.icon,
        animationUrl: gift.animationUrl || gift.icon,
        effectType: gift.effectType,
        duration: finalDuration,
      });

      socket.emit("store:gift:success", {
        balance: sender.coins,
      });

      // 🏆 Update Leaderboard
      await trophyController.updateLeaderboardOnGift(senderId, gift.price);
    } catch (err) {
      console.error("❌ Store gift send error:", err);
      socket.emit("store:gift:error", { message: "Store gift failed" });
    }
  });

  /* =========================================================
       🛒 BUY STORE GIFT FOR SELF
    ========================================================== */

  socket.on("store:gift:buy", async (payload) => {
    try {
      const userId = socket.data.userId;
      const { giftId, duration = 1 } = payload;

      if (!userId || !giftId) {
        return socket.emit("store:gift:error", { message: "Missing fields" });
      }

      const gift = await StoreGift.findOne({
        _id: giftId,
        isAvailable: true,
      })
        .select("name icon animationUrl price category rarity effectType")
        .lean();

      console.log("🛒 Gift fetched for self buy:", gift);

      if (!gift) {
        return socket.emit("store:gift:error", {
          message: "Gift not available",
        });
      }

      /* ===============================
           💰 Deduct Coins
        =============================== */

      const user = await User.findOneAndUpdate(
        { _id: userId, coins: { $gte: gift.price } },
        {
          $inc: {
            coins: -gift.price,
            totalSpent: gift.price,
          },
        },
        { new: true },
      );

      if (!user) {
        return socket.emit("store:gift:error", {
          message: "Insufficient coins",
        });
      }

      /* ===============================
           ⏳ Duration Logic
        =============================== */

      let finalDuration = duration;

      if (gift.effectType === "ENTRANCE" || gift.effectType === "FRAME") {
        finalDuration = 3;
      }

      const expiresAt = new Date(Date.now() + finalDuration * 86400000);

      /* ===============================
   Disable previous same effect
=============================== */

      if (gift.effectType !== "NONE") {
        await StoreGiftInventory.updateMany(
          {
            userId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
        );
      }

      /* ===============================
   Save Inventory
=============================== */

      await StoreGiftInventory.create({
        userId,
        giftId: gift._id,
        effectType: gift.effectType,
        icon: gift.icon,
        animationUrl: gift.animationUrl || gift.icon,
        duration: finalDuration,
        expiresAt,
        isActive: true,
      });

      /* ===============================
           Apply Profile Effect
        =============================== */

      const update = {};

      if (gift.effectType === "FRAME") {
        update["profile.frame"] = {
          icon: gift.icon,
          expiresAt: expiresAt,
        };
      }

      if (gift.effectType === "RING") {
        update["profile.ring"] = gift.icon;
      }

      if (gift.effectType === "BUBBLE") {
        update["profile.bubble"] = gift.icon;
      }

      if (gift.effectType === "ENTRANCE") {
        update["profile.entranceEffect"] = gift.animationUrl || gift.icon;
      }

      if (gift.effectType === "THEME") {
        update["profile.theme"] = gift.name.toLowerCase();
      }

      if (Object.keys(update).length > 0) {
        await User.findByIdAndUpdate(userId, { $set: update });
        const userSockets = await io.in(userId.toString()).fetchSockets();

        userSockets.forEach((s) => {
          if (!s.data.profile) s.data.profile = {};

          if (gift.effectType === "BUBBLE") {
            s.data.profile.bubble = gift.icon;
          }

          if (gift.effectType === "FRAME") {
            s.data.profile.frame = gift.icon;
          }
        });

        /* ===============================
     🔔 GLOBAL PROFILE UPDATE
  =============================== */

        io.to(userId.toString()).emit("profile:update", {
          effectType: gift.effectType,
          frame:
            gift.effectType === "FRAME"
              ? {
                icon: gift.icon,
                expiresAt,
              }
              : null,
          ring: gift.effectType === "RING" ? gift.icon : null,
          bubble: gift.effectType === "BUBBLE" ? gift.icon : null,
          entranceEffect:
            gift.effectType === "ENTRANCE"
              ? gift.animationUrl || gift.icon
              : null,
          theme: gift.effectType === "THEME" ? gift.name.toLowerCase() : null,
        });
      }

      /* ===============================
           Save Transaction
        =============================== */

      await StoreGiftTransaction.create({
        senderId: userId,
        receiverIds: [userId],
        giftId: gift._id,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftPrice: gift.price,
        giftCategory: gift.category,
        giftRarity: gift.rarity,
        quantitySent: 1,
        totalCoinsDeducted: gift.price,
        recipientCount: 1,
        status: "completed",
        completedAt: new Date(),
      });

      socket.emit("store:gift:bought", {
        giftId: gift._id,
        name: gift.name,
        icon: gift.icon,
        animationUrl: gift.animationUrl || gift.icon,
        effectType: gift.effectType,
        duration: finalDuration,
        balance: user.coins,
      });

      // 🏆 Update Leaderboard
      await trophyController.updateLeaderboardOnGift(userId, gift.price);
    } catch (err) {
      console.error("❌ Store buy error:", err);
      socket.emit("store:gift:error", {
        message: "Store gift purchase failed",
      });
    }
  });
};
