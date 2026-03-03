const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");
const Notification = require("../models/notification");
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
    });

    /* =========================
       JOIN CONVERSATION
    ========================= */
    socket.on("private:conversation:join", async ({ conversationId }) => {
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
    });

    /* =========================
       SEND MESSAGE (🔥 SECURE)
    ========================= */
    socket.on(
      "private:message:send",
      async ({ conversationId, recipientId, text, attachment }) => {
        const senderId = socket.data.userId;

        if (!conversationId || !recipientId || !senderId) return;
        if (!text && !attachment) return;

        if (
          !mongoose.Types.ObjectId.isValid(conversationId) ||
          !mongoose.Types.ObjectId.isValid(recipientId)
        ) {
          socket.emit("private:message:error", { error: "Invalid ID format" });
          return;
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
          socket.emit("private:message:error", { error: "Unauthorized" });
          return;
        }

        const isRecipientValid = conversation.participants.some(
          (p) => p.toString() === recipientId.toString(),
        );

        if (!isRecipientValid) {
          socket.emit("private:message:error", { error: "Invalid recipient" });
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

        const populated = await message
          .populate("sender", "username profile.avatar")
          .populate("recipient", "username profile.avatar");

        io.to(`private:${conversationId}`).emit(
          "private:message:receive",
          populated,
        );

        // Notification
        if (recipientId.toString() !== senderId.toString()) {
          const notification = await Notification.create({
            user: recipientId,
            type: "private_message",
            title: "New message",
            body: attachment
              ? "📷 Photo"
              : text.length > 40
                ? text.slice(0, 40) + "..."
                : text,
            data: { conversationId, senderId },
          });

          io.to(`notify:${recipientId}`).emit("notification:new", notification);
        }
      },
    );

    /* =========================
       READ RECEIPT (🔥 SECURE)
    ========================= */
    socket.on("private:message:read", async ({ messageId, conversationId }) => {
      const userId = socket.data.userId;
      if (!messageId || !conversationId) return;

      if (!mongoose.Types.ObjectId.isValid(messageId)) return;

      const message = await Message.findById(messageId);
      if (!message) return;

      // Only recipient can mark read
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
    });

    /* =========================
       EDIT MESSAGE (🔥 FIXED)
    ========================= */
    socket.on(
      "private:message:edit",
      async ({ messageId, conversationId, newText }) => {
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
      },
    );

    /* =========================
       DELETE MESSAGE
    ========================= */
    socket.on(
      "private:message:delete",
      async ({ messageId, conversationId }) => {
        const userId = socket.data.userId;
        if (!messageId) return;

        const message = await Message.findById(messageId);
        if (!message) return;

        if (message.sender.toString() !== userId.toString()) return;

        await Message.findByIdAndDelete(messageId);

        io.to(`private:${conversationId}`).emit("private:message:deleted", {
          messageId,
        });
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
