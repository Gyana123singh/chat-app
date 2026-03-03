const mongoose = require("mongoose");
const StoreGift = require("../models/storeGift");
const StoreGiftInventory = require("../models/storeGiftInventory");
const StoreGiftTransaction = require("../models/storeGiftTransaction");
const User = require("../models/users");

module.exports = (io) => {
  io.on("connection", (socket) => {

    socket.on("store:gift:send", async (payload) => {
      const session = await mongoose.startSession();

      try {
        const senderId = socket.data.userId;

        const {
          giftId,
          receiverId,
          roomId = null,
          duration = 1,
        } = payload;

        if (!senderId || !giftId || !receiverId) {
          return socket.emit("store:gift:error", { message: "Missing fields" });
        }

        if (receiverId.toString() === senderId.toString()) {
          return socket.emit("store:gift:error", {
            message: "Cannot send to yourself",
          });
        }

        // ✅ FIX #2 — Ensure receiver is in room (if roomId provided)
        if (roomId) {
          const sockets = await io.in(`room:${roomId}`).fetchSockets();
          const userIds = sockets.map((s) =>
            s.data.userId?.toString()
          );

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

        const totalCost = gift.price;

        if (sender.coins < totalCost) {
          return socket.emit("store:gift:error", {
            message: "Insufficient coins",
          });
        }

        // ===============================
        // START TRANSACTION
        // ===============================
        session.startTransaction();

        sender.coins -= totalCost;
        sender.totalSpent += totalCost;
        await sender.save({ session });

        const expiresAt = new Date(Date.now() + duration * 86400000);

        // Deactivate old same type
        await StoreGiftInventory.updateMany(
          {
            userId: receiverId,
            effectType: gift.effectType,
            isActive: true,
          },
          { $set: { isActive: false } },
          { session }
        );

        // Add inventory
        await StoreGiftInventory.create(
          [
            {
              userId: receiverId,
              giftId: gift._id,
              effectType: gift.effectType,
              icon: gift.icon,
              animationUrl: gift.animationUrl,
              duration,
              expiresAt,
              isActive: true,
            },
          ],
          { session }
        );

        // Apply profile update
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
          [
            {
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
              totalCoinsDeducted: totalCost,
              recipientCount: 1,
              status: "completed",
              completedAt: new Date(),
            },
          ],
          { session }
        );

        await session.commitTransaction();
        session.endSession();

        // ===============================
        // SOCKET EMITS
        // ===============================

        // Notify receiver (profile update)
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

        // ✅ FIX #1 — Safe abort
        try {
          await session.abortTransaction();
        } catch (e) {}

        session.endSession();

        console.error("❌ Store gift error:", err);
        socket.emit("store:gift:error", {
          message: "Store gift failed",
        });
      }
    });

  });
};