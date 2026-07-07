const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");
const Notification = require("../models/notification");
const Block = require("../models/blockUsers");
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

        socket.data.userId = userId;
        socket.data.username = username;
        socket.data.avatar = avatar;

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

        // Auto join conversations
        const conversations = await Conversation.find({
          participants: userId,
          isActive: true,
        }).select("_id");

        conversations.forEach((conv) => {
          socket.join(`private:${conv._id}`);
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
