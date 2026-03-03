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

      let session;

      try {
        session = await mongoose.startSession();

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

        // ✅ Ensure receiver is inside room (if provided)
        if (roomId) {
          const sockets = await io.in(`room:${roomId}`).fetchSockets();
          const userIds = sockets.map((s) => s.data.userId?.toString());

          if (!userIds.includes(receiverId.toString())) {
            return socket.emit("store:gift:error", {
              message: "Receiver not in room",
            });
          }
        }

        const gift = await StoreGift.findById(giftId);
        const sender = await User.findById(senderId);
        const receiver = await User.findById(receiverId);

        if (!gift || !gift.isAvailable) {
          return socket.emit("store:gift:error", {
            message: "Gift not available",
          });
        }

        if (!sender || !receiver) {
          return socket.emit("store:gift:error", {
            message: "User not found",
          });
        }

        if (sender.coins < gift.price) {
          return socket.emit("store:gift:error", {
            message: "Insufficient coins",
          });
        }

        // ================= TRANSACTION START =================
        session.startTransaction();

        sender.coins -= gift.price;
        sender.totalSpent += gift.price;
        await sender.save({ session });

        const expiresAt = new Date(Date.now() + duration * 86400000);

        // Deactivate previous same effect
        await StoreGiftInventory.updateMany(
          {
            userId: receiverId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
          { session }
        );

        // Add new inventory
        await StoreGiftInventory.create(
          [{
            userId: receiverId,
            giftId: gift._id,
            effectType: gift.effectType,
            icon: gift.icon,
            animationUrl: gift.animationUrl,
            duration,
            expiresAt,
            isActive: true,
          }],
          { session }
        );

        // Update receiver profile
        const update = {};

        if (gift.effectType === "FRAME") update["profile.frame"] = gift.icon;
        if (gift.effectType === "RING") update["profile.ring"] = gift.icon;
        if (gift.effectType === "BUBBLE") update["profile.bubble"] = gift.icon;
        if (gift.effectType === "ENTRANCE")
          update["profile.entranceEffect"] = gift.animationUrl;
        if (gift.effectType === "THEME")
          update["profile.theme"] = gift.name.toLowerCase();

        if (Object.keys(update).length > 0) {
          await User.findByIdAndUpdate(receiverId, { $set: update }, { session });
        }

        // Save transaction
        await StoreGiftTransaction.create(
          [{
            senderId,
            receiverIds: [receiverId],
            giftId: gift._id,
            giftName: gift.name,
            giftIcon: gift.icon,
            giftPrice: gift.price,
            giftCategory: gift.category,
            giftRarity: gift.rarity,
            sendType: "individual",
            quantitySent: 1,
            totalCoinsDeducted: gift.price,
            recipientCount: 1,
            status: "completed",
            completedAt: new Date(),
          }],
          { session }
        );

        await session.commitTransaction();
        session.endSession();

        // Notify receiver
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

        if (session) {
          try { await session.abortTransaction(); } catch (e) {}
          session.endSession();
        }

        console.error("❌ Store gift send error:", err);
        socket.emit("store:gift:error", { message: "Store gift failed" });
      }
    });


    /* =========================================================
       🛒 BUY STORE GIFT FOR SELF
    ========================================================== */
    socket.on("store:gift:buy", async (payload) => {

      let session;

      try {
        session = await mongoose.startSession();

        const userId = socket.data.userId;
        const { giftId, roomId = null, duration = 1 } = payload;

        if (!userId || !giftId) {
          return socket.emit("store:gift:error", {
            message: "Missing fields",
          });
        }

        const gift = await StoreGift.findById(giftId);
        const user = await User.findById(userId);

        if (!gift || !gift.isAvailable) {
          return socket.emit("store:gift:error", {
            message: "Gift not available",
          });
        }

        if (!user) {
          return socket.emit("store:gift:error", {
            message: "User not found",
          });
        }

        if (user.coins < gift.price) {
          return socket.emit("store:gift:error", {
            message: "Insufficient coins",
          });
        }

        // ================= TRANSACTION START =================
        session.startTransaction();

        user.coins -= gift.price;
        user.totalSpent += gift.price;
        await user.save({ session });

        const expiresAt = new Date(Date.now() + duration * 86400000);

        await StoreGiftInventory.updateMany(
          {
            userId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
          { session }
        );

        await StoreGiftInventory.create(
          [{
            userId,
            giftId: gift._id,
            effectType: gift.effectType,
            icon: gift.icon,
            animationUrl: gift.animationUrl,
            duration,
            expiresAt,
            isActive: true,
          }],
          { session }
        );

        const update = {};

        if (gift.effectType === "FRAME") update["profile.frame"] = gift.icon;
        if (gift.effectType === "RING") update["profile.ring"] = gift.icon;
        if (gift.effectType === "BUBBLE") update["profile.bubble"] = gift.icon;
        if (gift.effectType === "ENTRANCE")
          update["profile.entranceEffect"] = gift.animationUrl;
        if (gift.effectType === "THEME")
          update["profile.theme"] = gift.name.toLowerCase();

        if (Object.keys(update).length > 0) {
          await User.findByIdAndUpdate(userId, { $set: update }, { session });
        }

        await StoreGiftTransaction.create(
          [{
            senderId: userId,
            receiverIds: [userId],
            giftId: gift._id,
            giftName: gift.name,
            giftIcon: gift.icon,
            giftPrice: gift.price,
            giftCategory: gift.category,
            giftRarity: gift.rarity,
            sendType: "self",
            quantitySent: 1,
            totalCoinsDeducted: gift.price,
            recipientCount: 1,
            status: "completed",
            completedAt: new Date(),
          }],
          { session }
        );

        await session.commitTransaction();
        session.endSession();

        socket.emit("store:gift:bought", {
          giftId: gift._id,
          name: gift.name,
          icon: gift.icon,
          animationUrl: gift.animationUrl,
          effectType: gift.effectType,
          duration,
          balance: user.coins,
        });

        // Entrance animation in room
        if (roomId && gift.effectType === "ENTRANCE") {
          socket.to(`room:${roomId}`).emit("room:entranceEffect", {
            userId,
            animationUrl: gift.animationUrl,
          });
        }

      } catch (err) {

        if (session) {
          try { await session.abortTransaction(); } catch (e) {}
          session.endSession();
        }

        console.error("❌ Store buy error:", err);
        socket.emit("store:gift:error", {
          message: "Store gift purchase failed",
        });
      }
    });

  });
};