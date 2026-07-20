const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");
const Notification = require("../models/notification");
const Block = require("../models/blockUsers");
const User = require("../models/users");
const StoreGiftInventory = require("../models/storeGiftInventory");
const mongoose = require("mongoose");

module.exports = (io) => {
  const userSockets = new Map(); // userId -> Set(socketIds)
  const typingUsers = new Map(); // conversationId -> Set(userIds)

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER CONNECT
    ========================= */
    socket.on("private:user:connect", async ({ userId, username, avatar }) => {
      try {
        if (!userId) return;

        socket.userId = userId;
        socket.data = socket.data || {};
        socket.data.userId = userId;
        socket.data.username = username;
        socket.data.avatar = avatar;

        socket.join(userId.toString());
        socket.join(`notify:${userId}`);

        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }

        userSockets.get(userId).add(socket.id);

        io.emit("private:user:online", {
          userId,
          username,
          avatar,
          isOnline: true,
        });

        // Auto join conversations and push other participants' online status
        const conversations = await Conversation.find({
          participants: userId,
          isActive: true,
        });

        conversations.forEach((conv) => {
          socket.join(`private:${conv._id}`);
          
          const otherUserId = conv.participants.find(
            (p) => p && p.toString() !== userId.toString()
          );
          if (otherUserId) {
            const otherStr = otherUserId.toString();
            const isOnline = userSockets.has(otherStr) && userSockets.get(otherStr).size > 0;
            socket.emit("private:user:online", {
              userId: otherStr,
              isOnline,
            });
          }
        });
      } catch (error) {
        console.error("❌ private:user:connect error:", error);
      }
    });

    /* =========================
       CHECK ONLINE STATUS
    ========================= */
    socket.on("private:user:check_online", async ({ targetUserId }) => {
      try {
        if (!targetUserId) return;
        const key = targetUserId.toString();
        const isOnline = userSockets.has(key) && userSockets.get(key).size > 0;

        try {
          const TempLog = mongoose.models.TempLog || mongoose.model("TempLog", new mongoose.Schema({ error: String, timestamp: Date }, { strict: false }));
          const keys = Array.from(userSockets.keys());
          await TempLog.create({
            error: `ℹ️ check_online target: ${key}, found: ${isOnline}, all_keys: ${JSON.stringify(keys)}, map_has: ${userSockets.has(key)}`,
            timestamp: new Date()
          });
        } catch (logErr) {
          console.error("TempLog fail:", logErr);
        }

        socket.emit("private:user:online", {
          userId: targetUserId,
          isOnline,
        });
      } catch (err) {
        console.error("❌ check online error:", err);
      }
    });

    /* =========================
       JOIN CONVERSATION
    ========================= */
    socket.on("private:conversation:join", async ({ conversationId }) => {
      try {
        const userId = socket.data.userId;
        if (!conversationId || !userId) return;

        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;

        const isParticipant = conversation.participants.some(
          (p) => p.toString() === userId.toString(),
        );

        if (!isParticipant) return;

        socket.join(`private:${conversationId}`);
      } catch (error) {
        console.error("❌ conversation join error:", error);
      }
    });

    /* =========================
       SEND MESSAGE
    ========================= */
    socket.on(
      "private:message:send",
      async ({ conversationId, recipientId, text, attachment }) => {
        try {
          const senderId = socket.data.userId;

          if (!conversationId || !recipientId || !senderId) {
            socket.emit("private:message:error", {
              error: "Missing required fields",
            });
            return;
          }

          if (!text && !attachment) {
            socket.emit("private:message:error", {
              error: "Message cannot be empty",
            });
            return;
          }

          if (
            !mongoose.Types.ObjectId.isValid(conversationId) ||
            !mongoose.Types.ObjectId.isValid(recipientId)
          ) {
            socket.emit("private:message:error", {
              error: "Invalid ID format",
            });
            return;
          }

          // ✅ BLOCK CHECK (MUTUAL)
          const isBlocked = await Block.findOne({
            $or: [
              { blocker: senderId, blocked: recipientId },
              { blocker: recipientId, blocked: senderId },
            ],
          });

          if (isBlocked) {
            return socket.emit("private:message:error", {
              error: "You cannot message this user due to blocking",
            });
          }

          const conversation = await Conversation.findById(conversationId);

          if (!conversation) {
            socket.emit("private:message:error", {
              error: "Conversation not found",
            });
            return;
          }

          const isParticipant = conversation.participants.some(
            (p) => p.toString() === senderId.toString(),
          );

          if (!isParticipant) {
            socket.emit("private:message:error", {
              error: "Unauthorized",
            });
            return;
          }

          const isRecipientValid = conversation.participants.some(
            (p) => p.toString() === recipientId.toString(),
          );

          if (!isRecipientValid) {
            socket.emit("private:message:error", {
              error: "Invalid recipient",
            });
            return;
          }

          const message = await Message.create({
            conversationId,
            sender: senderId,
            recipient: recipientId,
            text: text ? text.trim() : "",
            attachment: attachment || null,
          });

          await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: message._id,
            lastMessageTime: new Date(),
          });

          // ✅ FIXED POPULATE
          await message.populate([
            { path: "sender", select: "username profile.avatar" },
            { path: "recipient", select: "username profile.avatar" },
          ]);

          io.to(`private:${conversationId}`).emit(
            "private:message:receive",
            message,
          );

          /* =========================
   CREATE NOTIFICATION
========================= */
          if (recipientId.toString() !== senderId.toString()) {
            const notification = await Notification.create({
              user: recipientId,
              type: "message",
              title: "New message",
              body: attachment
                ? "📷 Photo"
                : text
                  ? text.length > 40
                    ? text.slice(0, 40) + "..."
                    : text
                  : "New message",
              data: {
                conversationId,
                senderId,
              },
            });

            io.to(`notify:${recipientId}`).emit(
              "notification:new",
              notification,
            );
          }
        } catch (error) {
          console.error("❌ Error sending message:", error);

          socket.emit("private:message:error", {
            error: "Failed to send message",
          });
        }
      },
    );

    /* =========================
       READ RECEIPT
    ========================= */
    socket.on("private:message:read", async ({ messageId, conversationId }) => {
      try {
        const userId = socket.data.userId;

        if (!messageId || !conversationId) return;

        if (!mongoose.Types.ObjectId.isValid(messageId)) return;

        const message = await Message.findById(messageId);

        if (!message) return;

        if (message.recipient.toString() !== userId.toString()) return;

        message.isRead = true;
        message.readAt = new Date();
        await message.save();

        io.to(`private:${conversationId}`).emit("private:message:read", {
          messageId,
          isRead: true,
          readAt: message.readAt,
          readBy: userId,
        });
      } catch (error) {
        console.error("❌ read receipt error:", error);
      }
    });

    /* =========================
       EDIT MESSAGE
    ========================= */
    socket.on(
      "private:message:edit",
      async ({ messageId, conversationId, newText }) => {
        try {
          const userId = socket.data.userId;
          if (!messageId || !newText) return;

          const message = await Message.findById(messageId);
          if (!message) return;

          if (message.sender.toString() !== userId.toString()) return;

          message.text = newText.trim();
          message.edited = true;
          message.editedAt = new Date();
          await message.save();

          io.to(`private:${conversationId}`).emit("private:message:edited", {
            messageId,
            text: message.text,
            edited: true,
            editedAt: message.editedAt,
          });
        } catch (error) {
          console.error("❌ edit message error:", error);
        }
      },
    );

    /* =========================
   DELETE MESSAGE
========================= */
    socket.on(
      "private:message:delete",
      async ({ messageId, conversationId }) => {
        try {
          const userId = socket.data.userId;

          if (!messageId) return;

          // ✅ Prevent invalid ObjectId crash
          if (!mongoose.Types.ObjectId.isValid(messageId)) {
            socket.emit("private:message:error", {
              error: "Invalid message ID",
            });
            return;
          }

          const message = await Message.findById(messageId);

          if (!message) return;

          if (message.sender.toString() !== userId.toString()) return;

          await Message.findByIdAndDelete(messageId);

          io.to(`private:${conversationId}`).emit("private:message:deleted", {
            messageId,
          });
        } catch (error) {
          console.error("❌ delete message error:", error);
        }
      },
    );

    /* =========================
       RING GIFT ACCEPT/REJECT
    ========================= */
    socket.on("private:message:accept_ring", async (payload, callback) => {
      try {
        const userId = socket.data.userId;
        const { messageId, conversationId } = payload;
        if (!userId || !messageId || !conversationId) {
          return socket.emit("private:message:error", { error: "Missing fields" });
        }

        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit("private:message:error", { error: "Message not found" });
        }

        if (message.recipient.toString() !== userId.toString()) {
          return socket.emit("private:message:error", { error: "Unauthorized" });
        }

        if (!message.text.includes("|pending]")) {
          return socket.emit("private:message:error", { error: "Ring gift already processed" });
        }

        // Extract gift details from: [RING_GIFT:giftId|giftName|giftIcon|pending]
        const text = message.text;
        const startIndex = text.indexOf("[RING_GIFT:") + "[RING_GIFT:".length;
        const endIndex = text.lastIndexOf("]");
        if (endIndex <= startIndex) {
          return socket.emit("private:message:error", { error: "Invalid message format" });
        }

        const content = text.substring(startIndex, endIndex);
        const parts = content.split("|");
        const giftId = parts[0];
        const giftName = parts[1];
        const giftIcon = parts[2];

        const StoreGift = require("../models/storeGift");
        const StoreGiftInventory = require("../models/storeGiftInventory");
        const User = require("../models/users");

        const gift = await StoreGift.findById(giftId).lean();
        if (!gift) {
          return socket.emit("private:message:error", { error: "Gift details not found in DB" });
        }

        const finalDuration = 1; // 1 day standard duration for rings
        const expiresAt = new Date(Date.now() + finalDuration * 86400000);

        const recipientId = userId.toString();
        const senderId = message.sender.toString();

        // Disable previous active ring for both recipient and sender
        await StoreGiftInventory.updateMany(
          { userId: { $in: [recipientId, senderId] }, effectType: "RING", isActive: true },
          { $set: { isActive: false } }
        );

        // Save new active Ring to Inventory for recipient
        await StoreGiftInventory.create({
          userId: recipientId,
          giftId: gift._id,
          effectType: "RING",
          icon: giftIcon,
          animationUrl: gift.animationUrl || giftIcon,
          duration: finalDuration,
          expiresAt,
          isActive: true,
        });

        // Save new active Ring to Inventory for sender as well
        await StoreGiftInventory.create({
          userId: senderId,
          giftId: gift._id,
          effectType: "RING",
          icon: giftIcon,
          animationUrl: gift.animationUrl || giftIcon,
          duration: finalDuration,
          expiresAt,
          isActive: true,
        });

        const recipientUser = await User.findById(recipientId).select("username profile.avatar").lean();
        const senderUser = await User.findById(senderId).select("username profile.avatar").lean();

        const recipientPartnerData = {
          userId: senderUser?._id || senderId,
          username: senderUser?.username || "Friend",
          avatar: senderUser?.profile?.avatar || null,
        };

        const senderPartnerData = {
          userId: recipientUser?._id || recipientId,
          username: recipientUser?.username || "Friend",
          avatar: recipientUser?.profile?.avatar || null,
        };

        // Apply active ring to user profile for BOTH recipient and sender
        await User.findByIdAndUpdate(recipientId, {
          $set: {
            "profile.ring": giftIcon,
            "profile.ringPartner": recipientPartnerData,
          }
        });
        await User.findByIdAndUpdate(senderId, {
          $set: {
            "profile.ring": giftIcon,
            "profile.ringPartner": senderPartnerData,
          }
        });

        // Update message status to accepted
        message.text = `[RING_GIFT:${giftId}|${giftName}|${giftIcon}|accepted]`;
        await message.save();

        await message.populate([
          { path: "sender", select: "username profile.avatar" },
          { path: "recipient", select: "username profile.avatar" },
        ]);

        // Broadcast updated message to chat room
        io.to(`private:${conversationId}`).emit("private:message:receive", message);

        // Emit global profile:update to update UI and avatar decoration in real-time for BOTH users
        io.to(recipientId).emit("profile:update", {
          effectType: "RING",
          ring: giftIcon,
          ringPartner: recipientPartnerData,
        });
        io.to(senderId).emit("profile:update", {
          effectType: "RING",
          ring: giftIcon,
          ringPartner: senderPartnerData,
        });

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err) {
        console.error("❌ Accept ring error:", err);
        socket.emit("private:message:error", { error: "Failed to accept ring" });
      }
    });

    socket.on("private:message:reject_ring", async (payload, callback) => {
      try {
        const userId = socket.data.userId;
        const { messageId, conversationId } = payload;
        if (!userId || !messageId || !conversationId) return;

        const message = await Message.findById(messageId);
        if (!message || message.recipient.toString() !== userId.toString()) return;

        if (!message.text.includes("|pending]")) return;

        // Update status to rejected
        message.text = message.text.replace("|pending]", "|rejected]");
        await message.save();

        await message.populate([
          { path: "sender", select: "username profile.avatar" },
          { path: "recipient", select: "username profile.avatar" },
        ]);

        io.to(`private:${conversationId}`).emit("private:message:receive", message);

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (err) {
        console.error("❌ Reject ring error:", err);
      }
    });

    socket.on("cp:breakup:instant", async (data, callback) => {
      try {
        const userId = socket.data.userId || socket.userId;
        const { partnerUserId } = data || {};
        if (!userId) {
          if (typeof callback === "function") callback({ success: false, message: "Unauthorized" });
          return;
        }

        const user = await User.findById(userId);
        if (!user) {
          if (typeof callback === "function") callback({ success: false, message: "User not found" });
          return;
        }

        const currentCoins = Math.max(user.coins || 0, user.stats?.coins || 0);
        if (currentCoins < 60000) {
          if (typeof callback === "function") {
            callback({ success: false, message: `Insufficient coins (Available: ${currentCoins} coins, required: 60,000)` });
          }
          return;
        }

        // Deduct 60,000 coins
        if (user.coins >= 60000) {
          user.coins -= 60000;
          if (user.stats && user.stats.coins) user.stats.coins = user.coins;
        } else if (user.stats && user.stats.coins >= 60000) {
          user.stats.coins -= 60000;
          user.coins = user.stats.coins;
        } else {
          user.coins = Math.max(0, (user.coins || 0) - 60000);
        }

        const updatedCoins = Math.max(user.coins || 0, user.stats?.coins || 0);

        const partnerId = partnerUserId || user.profile?.ringPartner?.userId;

        // Clear ring & ringPartner for sender
        user.profile.ring = null;
        user.profile.ringPartner = null;
        await user.save();

        // Clear ring & ringPartner for partner without sending notification
        if (partnerId) {
          await User.findByIdAndUpdate(partnerId, {
            $set: {
              "profile.ring": null,
              "profile.ringPartner": null,
            }
          });

          await StoreGiftInventory.updateMany(
            { userId: partnerId, effectType: "RING" },
            { $set: { isActive: false } }
          );

          io.to(partnerId.toString()).emit("profile:update", {
            effectType: "RING",
            ring: null,
            ringPartner: null,
          });
        }

        await StoreGiftInventory.updateMany(
          { userId, effectType: "RING" },
          { $set: { isActive: false } }
        );

        // Emit profile update to sender with updated coins
        io.to(userId.toString()).emit("profile:update", {
          effectType: "RING",
          ring: null,
          ringPartner: null,
          coins: updatedCoins,
        });

        if (typeof callback === "function") {
          callback({ success: true, coins: updatedCoins });
        }
      } catch (err) {
        console.error("❌ CP instant breakup error:", err);
        if (typeof callback === "function") callback({ success: false, message: "Server error" });
      }
    });

    socket.on("cp:breakup:request", async (data, callback) => {
      try {
        const userId = socket.data?.userId || socket.userId;
        if (!userId) {
          if (typeof callback === "function") callback({ success: false, message: "Unauthorized (Please re-login)" });
          return;
        }

        const senderUser = await User.findById(userId).select("username profile.avatar profile.ringPartner");
        if (!senderUser) {
          if (typeof callback === "function") callback({ success: false, message: "Sender not found" });
          return;
        }

        let partnerUserId = data?.partnerUserId;
        if (!partnerUserId && senderUser.profile?.ringPartner) {
          partnerUserId = senderUser.profile.ringPartner.userId ? senderUser.profile.ringPartner.userId.toString() : null;
        }

        if (!partnerUserId) {
          if (typeof callback === "function") callback({ success: false, message: "Partner user ID not found" });
          return;
        }

        // Find or create conversation with participantsHash
        const sortedParticipants = [userId.toString(), partnerUserId.toString()].sort();
        const participantsHash = sortedParticipants.join("_");

        let conversation = await Conversation.findOne({
          participantsHash: participantsHash,
          isActive: true,
        });

        if (!conversation) {
          conversation = await Conversation.findOne({
            isGroup: false,
            participants: { $all: [userId, partnerUserId] },
          });
        }

        if (!conversation) {
          conversation = await Conversation.create({
            isGroup: false,
            participants: sortedParticipants,
            participantsHash: participantsHash,
            isActive: true,
          });
        }

        const msgText = `[CP_BREAKUP_REQUEST:${userId}|${senderUser.username}|pending]`;
        const message = await Message.create({
          conversationId: conversation._id,
          sender: userId,
          recipient: partnerUserId,
          text: msgText,
        });

        await message.populate([
          { path: "sender", select: "username profile.avatar" },
          { path: "recipient", select: "username profile.avatar" },
        ]);

        // Broadcast to 1-to-1 private chat
        io.to(`private:${conversation._id}`).emit("private:message:receive", message);

        // Emit real-time breakup popup to partner if online
        io.to(partnerUserId.toString()).emit("cp:breakup:popup", {
          messageId: message._id,
          senderId: userId,
          senderName: senderUser.username,
          senderAvatar: senderUser.profile?.avatar,
        });

        if (typeof callback === "function") callback({ success: true });
      } catch (err) {
        console.error("❌ CP breakup request error:", err);
        if (typeof callback === "function") callback({ success: false, message: err.message || "Server error" });
      }
    });

    socket.on("cp:breakup:respond", async (data, callback) => {
      try {
        const userId = socket.data.userId || socket.userId;
        const { messageId, accepted } = data || {};

        if (!messageId) {
          if (typeof callback === "function") callback({ success: false, message: "Invalid messageId" });
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          if (typeof callback === "function") callback({ success: false, message: "Message not found" });
          return;
        }

        const senderId = message.sender.toString();
        const recipientId = message.recipient.toString();

        if (accepted) {
          // Remove active ring & ringPartner for BOTH users
          await User.findByIdAndUpdate(senderId, {
            $set: { "profile.ring": null, "profile.ringPartner": null }
          });
          await User.findByIdAndUpdate(recipientId, {
            $set: { "profile.ring": null, "profile.ringPartner": null }
          });

          await StoreGiftInventory.updateMany(
            { userId: { $in: [senderId, recipientId] }, effectType: "RING" },
            { $set: { isActive: false } }
          );

          message.text = `[CP_BREAKUP_REQUEST:${senderId}|${accepted ? "accepted" : "rejected"}]`;
          await message.save();

          await message.populate([
            { path: "sender", select: "username profile.avatar" },
            { path: "recipient", select: "username profile.avatar" },
          ]);

          io.to(`private:${message.conversationId}`).emit("private:message:receive", message);

          // Update profiles on both phones in real-time
          io.to(senderId).emit("profile:update", { effectType: "RING", ring: null, ringPartner: null });
          io.to(recipientId).emit("profile:update", { effectType: "RING", ring: null, ringPartner: null });

          io.to(senderId).emit("cp:breakup:result", { accepted: true, message: "Breakup request was accepted." });
        } else {
          message.text = `[CP_BREAKUP_REQUEST:${senderId}|rejected]`;
          await message.save();

          await message.populate([
            { path: "sender", select: "username profile.avatar" },
            { path: "recipient", select: "username profile.avatar" },
          ]);

          io.to(`private:${message.conversationId}`).emit("private:message:receive", message);
          io.to(senderId).emit("cp:breakup:result", { accepted: false, message: "Breakup request was rejected." });
        }

        if (typeof callback === "function") callback({ success: true });
      } catch (err) {
        console.error("❌ CP breakup respond error:", err);
        if (typeof callback === "function") callback({ success: false, message: "Server error" });
      }
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const userId = socket.data.userId;
      if (!userId) return;

      const sockets = userSockets.get(userId);
      if (!sockets) return;

      sockets.delete(socket.id);

      if (sockets.size === 0) {
        userSockets.delete(userId);

        io.emit("private:user:online", {
          userId,
          isOnline: false,
        });
      }

      console.log("❌ Socket disconnected:", socket.id);
    });
  });
};
