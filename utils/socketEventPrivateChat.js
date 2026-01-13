const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");

/**
 * ✅ Private Chat Socket.IO Handler
 * Add this to your existing socket handler or merge with current io handler
 * Requires: socket.io, mongoose models, and Message/Conversation models
 */

module.exports = (io) => {
  // Track online users for direct messaging
  const onlineUsers = new Map(); // userId -> socketId
  const typingUsers = new Map(); // conversationId -> Set of userIds
  const userSockets = new Map(); // userId -> Set of socketIds (for multi-device support)

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       PRIVATE CHAT - USER CONNECT
    ========================= */
    socket.on("private:user:connect", ({ userId, username, avatar }) => {
      if (!userId) {
        console.warn("❌ User ID is required for connection");
        return;
      }

      // Store socket data
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      // Track online user (latest socket)
      onlineUsers.set(userId, socket.id);

      // Track multiple sockets per user
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);

      // Notify all users that this user is online
      io.emit("private:user:online", {
        userId,
        username,
        avatar,
        isOnline: true,
        socketId: socket.id,
      });

      console.log(
        `🟢 User available for DM: ${username} (${userId}) - Socket: ${socket.id}`
      );
    });

    /* =========================
       PRIVATE CHAT - SEND MESSAGE (Socket.IO)
    ========================= */
    socket.on("private:message:send", async (data) => {
      const { conversationId, recipientId, text, attachment } = data;
      const senderId = socket.data.userId;

      if (!conversationId || !recipientId || !text || !senderId) {
        console.warn("❌ Missing message data:", {
          conversationId,
          recipientId,
          text: !!text,
          senderId,
        });
        socket.emit("private:message:error", {
          error: "Missing required fields",
        });
        return;
      }

      try {
        // ✅ Validate message length
        if (text.trim().length === 0) {
          socket.emit("private:message:error", {
            error: "Message text cannot be empty",
          });
          return;
        }

        if (text.length > 1000) {
          socket.emit("private:message:error", {
            error: "Message text cannot exceed 1000 characters",
          });
          return;
        }

        // ✅ Save message to database
        const message = new Message({
          conversationId,
          sender: senderId,
          recipient: recipientId,
          text: text.trim(),
          attachment: attachment || null,
        });

        await message.save();
        await message.populate("sender", "id username avatar");
        await message.populate("recipient", "id username avatar");

        // ✅ Update conversation's lastMessage
        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: message._id,
          lastMessageTime: new Date(),
        });

        // ✅ Create room for this conversation if not exists
        const conversationRoom = `private:${conversationId}`;

        // ✅ Join both users to conversation room
        socket.join(conversationRoom);
        const recipientSocket = onlineUsers.get(recipientId);
        if (recipientSocket) {
          io.to(recipientSocket).socketsJoin(conversationRoom);
        }

        // ✅ Broadcast to both participants in real-time
        io.to(conversationRoom).emit("private:message:receive", {
          id: message._id,
          conversationId,
          sender: message.sender,
          recipient: message.recipient,
          text: message.text,
          attachment: message.attachment,
          isRead: false,
          readAt: null,
          edited: false,
          editedAt: null,
          createdAt: message.createdAt,
        });

        // ✅ Notify recipient if offline
        if (!recipientSocket) {
          io.emit("private:message:notification", {
            conversationId,
            senderId,
            senderUsername: socket.data.username,
            senderAvatar: socket.data.avatar,
            text: text.substring(0, 100),
            timestamp: new Date(),
          });
        }

        console.log(
          `💬 Private message sent: ${senderId} -> ${recipientId} (${message._id})`
        );
      } catch (error) {
        console.error("❌ Error sending private message:", error);
        socket.emit("private:message:error", {
          error: "Failed to send message",
          details: error.message,
        });
      }
    });

    /* =========================
       PRIVATE CHAT - TYPING INDICATOR
    ========================= */
    socket.on("private:typing", ({ conversationId, isTyping }) => {
      const userId = socket.data.userId;
      const username = socket.data.username;

      if (!conversationId || !userId) {
        console.warn("❌ Missing typing data");
        return;
      }

      const conversationRoom = `private:${conversationId}`;

      // ✅ Track typing users
      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }

      const typing = typingUsers.get(conversationId);

      if (isTyping) {
        typing.add(userId);
      } else {
        typing.delete(userId);
      }

      // ✅ Broadcast to others in conversation (not sender)
      socket.to(conversationRoom).emit("private:typing", {
        userId,
        username,
        isTyping,
        typingUsers: Array.from(typing),
      });

      console.log(
        `⌨️ ${username} is ${
          isTyping ? "typing" : "stopped typing"
        } in ${conversationId}`
      );
    });

    /* =========================
       PRIVATE CHAT - READ RECEIPT
    ========================= */
    socket.on("private:message:read", async (data) => {
      const { messageId, conversationId } = data;
      const userId = socket.data.userId;

      if (!messageId || !conversationId) {
        console.warn("❌ Missing read receipt data");
        return;
      }

      try {
        const message = await Message.findByIdAndUpdate(
          messageId,
          {
            isRead: true,
            readAt: new Date(),
          },
          { new: true }
        );

        if (!message) {
          console.warn(`⚠️ Message ${messageId} not found`);
          return;
        }

        const conversationRoom = `private:${conversationId}`;
        io.to(conversationRoom).emit("private:message:read", {
          messageId,
          isRead: true,
          readAt: message.readAt,
          readBy: userId,
        });

        console.log(`✅ Message ${messageId} marked as read by ${userId}`);
      } catch (error) {
        console.error("❌ Error marking message as read:", error);
        socket.emit("private:message:error", {
          error: "Failed to mark message as read",
        });
      }
    });

    /* =========================
       PRIVATE CHAT - EDIT MESSAGE
    ========================= */
    socket.on("private:message:edit", async (data) => {
      const { messageId, conversationId, newText } = data;
      const userId = socket.data.userId;

      if (!messageId || !newText || !conversationId) {
        console.warn("❌ Missing edit data");
        socket.emit("private:message:error", {
          error: "Missing required fields for edit",
        });
        return;
      }

      try {
        // ✅ Validate text
        if (newText.trim().length === 0) {
          socket.emit("private:message:error", {
            error: "Message text cannot be empty",
          });
          return;
        }

        if (newText.length > 1000) {
          socket.emit("private:message:error", {
            error: "Message text cannot exceed 1000 characters",
          });
          return;
        }

        const message = await Message.findById(messageId);

        if (!message) {
          socket.emit("private:message:error", {
            error: "Message not found",
          });
          return;
        }

        // ✅ Verify ownership
        if (message.sender.toString() !== userId) {
          socket.emit("private:message:error", {
            error: "You can only edit your own messages",
          });
          return;
        }

        // ✅ Edit message
        await message.editText(newText.trim());

        const conversationRoom = `private:${conversationId}`;
        io.to(conversationRoom).emit("private:message:edited", {
          messageId,
          text: newText.trim(),
          edited: true,
          editedAt: message.editedAt,
          editedBy: userId,
        });

        console.log(`✏️ Private message ${messageId} edited by ${userId}`);
      } catch (error) {
        console.error("❌ Error editing message:", error);
        socket.emit("private:message:error", {
          error: "Failed to edit message",
          details: error.message,
        });
      }
    });

    /* =========================
       PRIVATE CHAT - DELETE MESSAGE
    ========================= */
    socket.on("private:message:delete", async (data) => {
      const { messageId, conversationId } = data;
      const userId = socket.data.userId;

      if (!messageId || !conversationId) {
        console.warn("❌ Missing delete data");
        socket.emit("private:message:error", {
          error: "Missing required fields for delete",
        });
        return;
      }

      try {
        const message = await Message.findById(messageId);

        if (!message) {
          socket.emit("private:message:error", {
            error: "Message not found",
          });
          return;
        }

        // ✅ Verify ownership
        if (message.sender.toString() !== userId) {
          socket.emit("private:message:error", {
            error: "You can only delete your own messages",
          });
          return;
        }

        // ✅ Delete message
        await Message.findByIdAndDelete(messageId);

        const conversationRoom = `private:${conversationId}`;
        io.to(conversationRoom).emit("private:message:deleted", {
          messageId,
          deletedBy: userId,
        });

        console.log(`🗑️ Private message ${messageId} deleted by ${userId}`);
      } catch (error) {
        console.error("❌ Error deleting message:", error);
        socket.emit("private:message:error", {
          error: "Failed to delete message",
          details: error.message,
        });
      }
    });

    /* =========================
       PRIVATE CHAT - JOIN CONVERSATION
    ========================= */
    socket.on("private:conversation:join", ({ conversationId }) => {
      const userId = socket.data.userId;
      const username = socket.data.username;

      if (!conversationId) {
        console.warn("❌ Conversation ID required");
        return;
      }

      const conversationRoom = `private:${conversationId}`;
      socket.join(conversationRoom);

      // ✅ Notify other user that this user is active in conversation
      socket.to(conversationRoom).emit("private:user:active", {
        userId,
        username,
        conversationId,
      });

      console.log(
        `👤 User ${username} (${userId}) joined conversation ${conversationId}`
      );
    });

    /* =========================
       PRIVATE CHAT - LEAVE CONVERSATION
    ========================= */
    socket.on("private:conversation:leave", ({ conversationId }) => {
      const userId = socket.data.userId;
      const conversationRoom = `private:${conversationId}`;

      socket.leave(conversationRoom);

      // ✅ Notify other user that this user left
      socket.to(conversationRoom).emit("private:user:inactive", {
        userId,
        conversationId,
      });

      console.log(`👤 User ${userId} left conversation ${conversationId}`);
    });

    /* =========================
       PRIVATE CHAT - SEND NOTIFICATION
    ========================= */
    socket.on("private:notification:send", ({ toUserId, title, body }) => {
      const senderId = socket.data.userId;

      if (!toUserId) {
        console.warn("❌ Recipient user ID required");
        return;
      }

      const recipientSocket = onlineUsers.get(toUserId);

      if (recipientSocket) {
        io.to(recipientSocket).emit("private:notification:receive", {
          from: senderId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          title,
          body,
          timestamp: new Date(),
        });

        console.log(`🔔 Notification sent: ${senderId} -> ${toUserId}`);
      } else {
        console.log(
          `ℹ️ User ${toUserId} is offline, notification not delivered`
        );
      }
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const { userId, username } = socket.data;

      if (userId) {
        // Remove socket from tracking
        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);

          // Only mark user as offline if no other sockets exist
          if (sockets.size === 0) {
            onlineUsers.delete(userId);
            userSockets.delete(userId);

            // Clean up typing users
            for (const [conversationId, typingSet] of typingUsers) {
              typingSet.delete(userId);
            }

            // Broadcast user offline
            io.emit("private:user:online", {
              userId,
              username,
              isOnline: false,
            });

            console.log(`❌ User ${username} (${userId}) disconnected`);
          } else {
            console.log(
              `⚠️ User ${username} (${userId}) has ${sockets.size} remaining socket(s)`
            );
          }
        }
      }

      console.log("❌ Socket disconnected:", socket.id);
    });
  });
};
