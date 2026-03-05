const mongoose = require("mongoose");
const StoreGift = require("../models/storeGift");
const StoreGiftInventory = require("../models/storeGiftInventory");
const StoreGiftTransaction = require("../models/storeGiftTransaction");
const User = require("../models/users");

module.exports = (io) => {
  io.on("connection", (socket) => {
    /* =========================================================
       🎁 SEND STORE GIFT TO ANOTHER USER
    ========================================================== */
    socket.on("store:gift:send", async (payload) => {
      try {
        const senderId = socket.data.userId;
        const { giftId, receiverId, roomId = null, duration = 1 } = payload;

        if (!senderId || !giftId || !receiverId) {
          return socket.emit("store:gift:error", { message: "Missing fields" });
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
        });

        if (!gift) {
          return socket.emit("store:gift:error", {
            message: "Gift not available",
          });
        }

        const receiver = await User.findById(receiverId);

        if (!receiver) {
          return socket.emit("store:gift:error", {
            message: "Receiver not found",
          });
        }

        /* ===============================
           💰 Deduct Coins (Atomic)
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

        const expiresAt = new Date(Date.now() + duration * 86400000);

        /* ===============================
           🧹 Disable previous same effect
        =============================== */

        await StoreGiftInventory.updateMany(
          {
            userId: receiverId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
        );

        /* ===============================
           📦 Add inventory
        =============================== */

        await StoreGiftInventory.create({
          userId: receiverId,
          giftId: gift._id,
          effectType: gift.effectType,
          icon: gift.icon,
          animationUrl: gift.animationUrl,
          duration,
          expiresAt,
          isActive: true,
        });

        /* ===============================
           👤 Apply profile effects
        =============================== */

        const update = {};

        if (gift.effectType === "FRAME") update["profile.frame"] = gift.icon;
        if (gift.effectType === "RING") update["profile.ring"] = gift.icon;
        if (gift.effectType === "BUBBLE") update["profile.bubble"] = gift.icon;
        if (gift.effectType === "ENTRANCE")
          update["profile.entranceEffect"] = gift.animationUrl;
        if (gift.effectType === "THEME")
          update["profile.theme"] = gift.name.toLowerCase();

        if (Object.keys(update).length > 0) {
          await User.findByIdAndUpdate(receiverId, { $set: update });
        }

        /* ===============================
           🧾 Save transaction
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
           🎬 Cinematic Entrance
        =============================== */

        if (roomId && gift.effectType === "ENTRANCE") {
          const userData = await User.findById(receiverId).select(
            "username profile.avatar level",
          );

          io.to(`room:${roomId}`).emit("room:cinematicEntrance", {
            userId: receiverId,
            username: userData?.username || "User",
            avatar: userData?.profile?.avatar || null,
            level: userData?.level || 1,
            animationUrl: gift.animationUrl,
            soundUrl: gift.soundUrl || null,
            rarity: gift.rarity || "normal",
          });
        }

        /* ===============================
           📩 Notify receiver
        =============================== */

        io.to(receiverId.toString()).emit("store:gift:received", {
          giftId: gift._id,
          name: gift.name,
          icon: gift.icon,
          animationUrl: gift.animationUrl,
          effectType: gift.effectType,
          duration,
        });

        socket.emit("store:gift:success", {
          balance: sender.coins,
        });
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
        const { giftId, roomId = null, duration = 1 } = payload;

        if (!userId || !giftId) {
          return socket.emit("store:gift:error", { message: "Missing fields" });
        }

        const gift = await StoreGift.findOne({
          _id: giftId,
          isAvailable: true,
        });

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

        const expiresAt = new Date(Date.now() + duration * 86400000);

        await StoreGiftInventory.updateMany(
          {
            userId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
        );

        await StoreGiftInventory.create({
          userId,
          giftId: gift._id,
          effectType: gift.effectType,
          icon: gift.icon,
          animationUrl: gift.animationUrl,
          duration,
          expiresAt,
          isActive: true,
        });

        /* ===============================
           👤 Apply profile effects
        =============================== */

        const update = {};

        if (gift.effectType === "FRAME") update["profile.frame"] = gift.icon;
        if (gift.effectType === "RING") update["profile.ring"] = gift.icon;
        if (gift.effectType === "BUBBLE") update["profile.bubble"] = gift.icon;
        if (gift.effectType === "ENTRANCE")
          update["profile.entranceEffect"] = gift.animationUrl;
        if (gift.effectType === "THEME")
          update["profile.theme"] = gift.name.toLowerCase();

        if (Object.keys(update).length > 0) {
          await User.findByIdAndUpdate(userId, { $set: update });
        }

        /* ===============================
           🧾 Save transaction
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
          animationUrl: gift.animationUrl,
          effectType: gift.effectType,
          duration,
          balance: user.coins,
        });
      } catch (err) {
        console.error("❌ Store buy error:", err);
        socket.emit("store:gift:error", {
          message: "Store gift purchase failed",
        });
      }
    });
  });
};
