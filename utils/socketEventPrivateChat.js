const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");
const Notification = require("../models/notification");

module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId (legacy, not relied on)
  const typingUsers = new Map(); // conversationId -> Set of userIds
  const userSockets = new Map(); // userId -> Set of socketIds (multi-device safe)

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER CONNECT  (🔥 UPDATED)
    ========================= */
    socket.on("private:user:connect", async ({ userId, username, avatar }) => {
      if (!userId) {
        console.warn("❌ User ID is required for connection");
        return;
      }

      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      // ✅ JOIN NOTIFICATION ROOM (SAFE ADD)
      socket.join(`notify:${userId}`);

      // Multi-device safe tracking
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);

      onlineUsers.set(userId, socket.id); // keep for compatibility

      console.log(`🟢 User connected: ${username} (${userId})`);

      io.emit("private:user:online", {
        userId,
        username,
        avatar,
        isOnline: true,
      });

      // 🔥 AUTO-JOIN ALL ACTIVE CONVERSATIONS (CRITICAL FIX)
      try {
        const conversations = await Conversation.find({
          participants: userId,
          isActive: true,
        }).select("_id");

        conversations.forEach((conv) => {
          const room = `private:${conv._id}`;
          socket.join(room);
          console.log(`🔗 Auto-joined room ${room} for user ${userId}`);
        });
      } catch (err) {
        console.error("❌ Auto-join conversations error:", err.message);
      }
    });

    /* =========================
       JOIN CONVERSATION (🔒 SECURED)
    ========================= */
    socket.on("private:conversation:join", async ({ conversationId }) => {
      const userId = socket.data.userId;
      const username = socket.data.username;

      if (!conversationId || !userId) {
        console.warn("❌ Missing data for joining conversation");
        return;
      }

      try {
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
          console.warn("❌ Conversation not found:", conversationId);
          return;
        }

        const isParticipant = conversation.participants.some(
          (p) => p.toString() === userId.toString(),
        );

        if (!isParticipant) {
          console.warn(
            `❌ User ${userId} tried to join unauthorized conversation ${conversationId}`,
          );
          return;
        }

        const room = `private:${conversationId}`;
        socket.join(room);

        console.log(`🔗 User ${userId} joined room ${room}`);

        socket.to(room).emit("private:user:active", {
          userId,
          username,
          conversationId,
        });
      } catch (err) {
        console.error("❌ Error joining conversation:", err.message);
      }
    });

    /* =========================
       SEND MESSAGE
    ========================= */
    socket.on(
      "private:message:send",
      async ({ conversationId, recipientId, text, attachment }) => {
        const senderId = socket.data.userId;

        console.log("📤 private:message:send", {
          conversationId,
          senderId,
          recipientId,
        });

        if (!conversationId || !recipientId || !text || !senderId) {
          console.warn("❌ Missing message data");
          socket.emit("private:message:error", {
            error: "Missing required fields",
          });
          return;
        }

        try {
          if (text.trim().length === 0) {
            socket.emit("private:message:error", {
              error: "Message cannot be empty",
            });
            return;
          }

          if (text.length > 1000) {
            socket.emit("private:message:error", {
              error: "Message too long",
            });
            return;
          }

          const message = await Message.create({
            conversationId,
            sender: senderId,
            recipient: recipientId,
            text: text.trim(),
            attachment: attachment || null,
          });

          await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: message._id,
            lastMessageTime: new Date(),
          });

          const populated = await message
            .populate("sender", "username avatar")
            .populate("recipient", "username avatar");

          const room = `private:${conversationId}`;

          io.to(room).emit("private:message:receive", populated);

          /* =========================
             🔔 NOTIFICATION (ONLY ADD)
          ========================= */
          if (recipientId.toString() !== senderId.toString()) {
            const notification = await Notification.create({
              user: recipientId,
              type: "private_message",
              title: "New message",
              body: text.length > 40 ? text.slice(0, 40) + "..." : text,
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
          console.log(`✅ Message emitted to room ${room}: ${message._id}`);
        } catch (error) {
          console.error("❌ Error sending message:", error);
          socket.emit("private:message:error", {
            error: "Failed to send message",
            details: error.message,
          });
        }
      },
    );

    /* =========================
       NOTIFICATION READ
    ========================= */
    socket.on("notification:read", async ({ notificationId }) => {
      if (!notificationId) return;

      await Notification.findByIdAndUpdate(notificationId, {
        isRead: true,
        readAt: new Date(),
      });
    });
    /* =========================
       NOTIFICATION UNREAD
    ========================= */
    socket.on("notification:get:unread", async () => {
      const userId = socket.data.userId;
      if (!userId) return;

      const count = await Notification.countDocuments({
        user: userId,
        isRead: false,
      });

      socket.emit("notification:unread", count);
    });

    /* =========================
       TYPING INDICATOR
    ========================= */
    socket.on("private:typing", ({ conversationId, isTyping }) => {
      const userId = socket.data.userId;
      const username = socket.data.username;

      if (!conversationId || !userId) return;

      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }

      const typingSet = typingUsers.get(conversationId);

      if (isTyping) typingSet.add(userId);
      else typingSet.delete(userId);

      socket.to(`private:${conversationId}`).emit("private:typing", {
        userId,
        username,
        isTyping,
        typingUsers: Array.from(typingSet),
      });
    });

    /* =========================
       READ RECEIPT
    ========================= */
    socket.on("private:message:read", async ({ messageId, conversationId }) => {
      const userId = socket.data.userId;

      console.log("👁 private:message:read", { messageId, userId });

      if (!messageId || !conversationId) return;

      try {
        const message = await Message.findByIdAndUpdate(
          messageId,
          { isRead: true, readAt: new Date() },
          { new: true },
        );

        if (!message) return;

        io.to(`private:${conversationId}`).emit("private:message:read", {
          messageId,
          isRead: true,
          readAt: message.readAt,
          readBy: userId,
        });
      } catch (error) {
        console.error("❌ Error marking message as read:", error);
      }
    });

    /* =========================
       EDIT MESSAGE
    ========================= */
    socket.on(
      "private:message:edit",
      async ({ messageId, conversationId, newText }) => {
        const userId = socket.data.userId;

        console.log("✏️ private:message:edit", { messageId, userId });

        if (!messageId || !conversationId || !newText) return;

        try {
          const message = await Message.findById(messageId);
          if (!message) return;

          if (message.sender.toString() !== userId) return;

          await message.editText(newText.trim());

          io.to(`private:${conversationId}`).emit("private:message:edited", {
            messageId,
            text: newText.trim(),
            edited: true,
            editedAt: message.editedAt,
            editedBy: userId,
          });
        } catch (error) {
          console.error("❌ Error editing message:", error);
        }
      },
    );

    /* =========================
       DELETE MESSAGE
    ========================= */
    socket.on(
      "private:message:delete",
      async ({ messageId, conversationId }) => {
        const userId = socket.data.userId;

        console.log("🗑 private:message:delete", { messageId, userId });

        if (!messageId || !conversationId) return;

        try {
          const message = await Message.findById(messageId);
          if (!message) return;

          if (message.sender.toString() !== userId) return;

          await Message.findByIdAndDelete(messageId);

          io.to(`private:${conversationId}`).emit("private:message:deleted", {
            messageId,
            deletedBy: userId,
          });
        } catch (error) {
          console.error("❌ Error deleting message:", error);
        }
      },
    );

    /* =========================
       LEAVE CONVERSATION
    ========================= */
    socket.on("private:conversation:leave", ({ conversationId }) => {
      if (!conversationId) return;

      socket.leave(`private:${conversationId}`);

      socket.to(`private:${conversationId}`).emit("private:user:inactive", {
        userId: socket.data.userId,
        conversationId,
      });

      console.log(`👤 User left room private:${conversationId}`);
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const { userId, username } = socket.data;

      if (userId) {
        const sockets = userSockets.get(userId);

        if (sockets) {
          sockets.delete(socket.id);

          if (sockets.size === 0) {
            userSockets.delete(userId);
            onlineUsers.delete(userId);

            io.emit("private:user:online", {
              userId,
              username,
              isOnline: false,
            });

            console.log(`❌ User offline: ${username} (${userId})`);
          }
        }
      }

      console.log("❌ Socket disconnected:", socket.id);
    });
  });
};
