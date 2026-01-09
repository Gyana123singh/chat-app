module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER CONNECT
    ========================= */
    socket.on("user:connect", ({ userId, username, avatar }) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      micStates.set(userId, { muted: false, speaking: false });

      console.log("🟢 User connected:", { userId, username });
    });

    /* =========================
       ROOM JOIN
    ========================= */
    socket.on("room:join", async ({ roomId, user }) => {
      if (!roomId || !user) return;

      const roomName = `room:${roomId}`;
      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.user = user;

      // 🔥 Track users in room
      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set());
      }
      roomUsers.get(roomId).add(user.id);

      console.log(`📍 ${user.username} joined ${roomName}`);

      try {
        const sockets = await io.in(roomName).fetchSockets();

        const usersInRoom = sockets
          .filter((s) => s.data.user && s.id !== socket.id)
          .map((s) => ({
            ...s.data.user,
            mic: micStates.get(s.data.user.id) || {
              muted: false,
              speaking: false,
            },
          }));

        socket.emit("room:users", usersInRoom);
        socket.to(roomName).emit("room:userJoined", user);

        const messages = roomMessages.get(roomId) || [];
        socket.emit("room:messages", messages);
      } catch (err) {
        console.error("❌ room:join error:", err);
      }
    });

    /* =========================
       MIC MUTE
    ========================= */
    socket.on("mic:mute", () => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      micStates.set(userId, { muted: true, speaking: false });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: true,
        speaking: false,
      });

      console.log(`🔇 ${userId} muted mic`);
    });

    /* =========================
       MIC UNMUTE
    ========================= */
    socket.on("mic:unmute", () => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      micStates.set(userId, { muted: false, speaking: false });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking: false,
      });

      console.log(`🎤 ${userId} unmuted mic`);
    });

    /* =========================
       SPEAKING STATUS
    ========================= */
    socket.on("mic:speaking", (speaking) => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      const state = micStates.get(userId);
      if (!state || state.muted) return;

      micStates.set(userId, { ...state, speaking });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking,
      });
    });

    /* =========================
       WEBRTC OFFER
    ========================= */
    socket.on("call:offer", ({ to, offer }) => {
      const targetSocket = onlineUsers.get(to);
      if (!targetSocket) return;

      io.to(targetSocket).emit("call:offer", {
        from: socket.data.userId,
        offer,
      });
    });

    /* =========================
       WEBRTC ANSWER
    ========================= */
    socket.on("call:answer", ({ to, answer }) => {
      const targetSocket = onlineUsers.get(to);
      if (!targetSocket) return;

      io.to(targetSocket).emit("call:answer", {
        from: socket.data.userId,
        answer,
      });
    });

    /* =========================
       WEBRTC ICE
    ========================= */
    socket.on("call:ice", ({ to, candidate }) => {
      const targetSocket = onlineUsers.get(to);
      if (!targetSocket) return;

      io.to(targetSocket).emit("call:ice", {
        from: socket.data.userId,
        candidate,
      });
    });

    /* =========================
       SEND MESSAGE
    ========================= */
    socket.on("message:send", ({ roomId, text }) => {
      const { userId, username, avatar } = socket.data;
      if (!roomId || !text || !userId) return;

      const roomName = `room:${roomId}`;

      const message = {
        id: `${userId}-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`,
        userId,
        username,
        avatar,
        text,
        timestamp: new Date().toISOString(),
        edited: false,
        editedAt: null,
      };

      if (!roomMessages.has(roomId)) {
        roomMessages.set(roomId, []);
      }
      roomMessages.get(roomId).push(message);

      io.to(roomName).emit("message:receive", message);

      console.log(`💬 Message sent in ${roomName}:`, {
        userId,
        text: text.substring(0, 50),
      });
    });

    /* =========================
       TYPING INDICATOR
    ========================= */
    socket.on("message:typing", ({ roomId, isTyping }) => {
      const { userId, username } = socket.data;
      if (!roomId || !userId) return;

      const roomName = `room:${roomId}`;

      if (!typingUsers.has(roomId)) {
        typingUsers.set(roomId, new Set());
      }

      const typingSet = typingUsers.get(roomId);

      if (isTyping) {
        typingSet.add(userId);
      } else {
        typingSet.delete(userId);
      }

      socket.to(roomName).emit("message:typing", {
        userId,
        username,
        isTyping,
        typingUsers: Array.from(typingSet),
      });

      console.log(
        `⌨️ ${username} is ${isTyping ? "typing" : "not typing"} in ${roomName}`
      );
    });

    /* =========================
       EDIT MESSAGE
    ========================= */
    socket.on("message:edit", ({ roomId, messageId, newText }) => {
      const { userId, roomId: userRoomId } = socket.data;
      if (!roomId || !messageId || !newText || !userId) return;

      if (userRoomId !== roomId) {
        console.warn(
          `❌ User ${userId} tried to edit message in unauthorized room`
        );
        return;
      }

      const roomName = `room:${roomId}`;
      const messages = roomMessages.get(roomId);

      if (!messages) return;

      const messageIndex = messages.findIndex((msg) => msg.id === messageId);
      if (messageIndex === -1) {
        console.warn(`❌ Message ${messageId} not found`);
        return;
      }

      const message = messages[messageIndex];

      if (message.userId !== userId) {
        console.warn(
          `❌ User ${userId} tried to edit message by ${message.userId}`
        );
        socket.emit("message:error", {
          messageId,
          error: "You can only edit your own messages",
        });
        return;
      }

      message.text = newText;
      message.edited = true;
      message.editedAt = new Date().toISOString();
      messages[messageIndex] = message;

      io.to(roomName).emit("message:edited", message);

      console.log(`✏️ Message ${messageId} edited in ${roomName}`);
    });

    /* =========================
       DELETE MESSAGE
    ========================= */
    socket.on("message:delete", ({ roomId, messageId }) => {
      const { userId, roomId: userRoomId } = socket.data;
      if (!roomId || !messageId || !userId) return;

      if (userRoomId !== roomId) {
        console.warn(
          `❌ User ${userId} tried to delete message in unauthorized room`
        );
        return;
      }

      const roomName = `room:${roomId}`;
      const messages = roomMessages.get(roomId);

      if (!messages) return;

      const messageIndex = messages.findIndex((msg) => msg.id === messageId);
      if (messageIndex === -1) {
        console.warn(`❌ Message ${messageId} not found`);
        return;
      }

      const message = messages[messageIndex];

      if (message.userId !== userId) {
        console.warn(
          `❌ User ${userId} tried to delete message by ${message.userId}`
        );
        socket.emit("message:error", {
          messageId,
          error: "You can only delete your own messages",
        });
        return;
      }

      messages.splice(messageIndex, 1);

      io.to(roomName).emit("message:deleted", { messageId });

      console.log(`🗑️ Message ${messageId} deleted from ${roomName}`);
    });

    /* =========================
       🔥 GIFT SEND - REAL-TIME
    ========================= */
    socket.on(
      "gift:send",
      async ({ roomId, giftId, sendType, recipientIds, speakingUsers }) => {
        const { userId, username, avatar } = socket.data;

        if (!roomId || !userId || !giftId) {
          socket.emit("gift:error", {
            message: "Missing required data",
          });
          return;
        }

        try {
          // 🔥 Get gift data (for UI display only)
          const gift = await Gift.findById(giftId);
          if (!gift) {
            socket.emit("gift:error", { message: "Gift not found" });
            return;
          }

          // 📋 Prepare recipient list based on sendType
          let finalRecipients = [];

          if (sendType === "individual") {
            finalRecipients = recipientIds || [];
          } else if (sendType === "all_in_room") {
            const roomName = `room:${roomId}`;
            const sockets = await io.in(roomName).fetchSockets();
            finalRecipients = sockets
              .map((s) => s.data.userId)
              .filter((id) => id && id.toString() !== userId.toString());
          } else if (sendType === "all_on_mic") {
            finalRecipients = speakingUsers || [];
          }

          // Remove sender from recipients
          finalRecipients = finalRecipients.filter(
            (id) => id.toString() !== userId.toString()
          );

          if (finalRecipients.length === 0) {
            socket.emit("gift:error", { message: "No valid recipients" });
            return;
          }

          // 🎁 Broadcast gift animation (no coin logic here)
          const roomName = `room:${roomId}`;
          io.to(roomName).emit("gift:received", {
            senderId: userId,
            senderUsername: username,
            senderAvatar: avatar,
            giftName: gift.name,
            giftIcon: gift.icon,
            giftPrice: gift.price,
            giftRarity: gift.rarity,
            sendType,
            recipientCount: finalRecipients.length,
            totalCoinsTransferred: gift.price * finalRecipients.length,
            timestamp: new Date().toISOString(),
            animation: true,
          });

          console.log(`🎁 Gift "${gift.name}" animation sent in ${roomName}`);
        } catch (error) {
          console.error("❌ gift:send socket error:", error.message);
          socket.emit("gift:error", {
            message: "Error sending gift",
            error: error.message,
          });
        }
      }
    );

    /* =========================
       🔥 GET ROOM USERS & MIC STATUS
    ========================= */
    socket.on("room:getUsersStatus", async ({ roomId }) => {
      if (!roomId) return;

      try {
        const roomName = `room:${roomId}`;
        const sockets = await io.in(roomName).fetchSockets();

        const usersStatus = sockets
          .filter((s) => s.data.user)
          .map((s) => ({
            userId: s.data.user.id,
            username: s.data.user.username,
            avatar: s.data.user.avatar,
            mic: micStates.get(s.data.user.id) || {
              muted: false,
              speaking: false,
            },
          }));

        socket.emit("room:usersStatus", {
          allUsers: usersStatus,
          onMicUsers: usersStatus.filter((u) => !u.mic.muted),
          speakingUsers: usersStatus.filter((u) => u.mic.speaking),
        });
      } catch (error) {
        console.error("❌ room:getUsersStatus error:", error.message);
      }
    });

    /* ======================
       FRIEND REQUEST SEND
    ====================== */
    socket.on("friend:request:send", ({ toUserId }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !toUserId) return;

      const targetSocket = onlineUsers.get(toUserId);

      if (targetSocket) {
        io.to(targetSocket).emit("friend:request:received", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          timestamp: new Date().toISOString(),
        });
      }
    });

    /* ======================
       FRIEND REQUEST ACCEPT
    ====================== */
    socket.on("friend:request:accept", ({ toUserId }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !toUserId) return;

      const targetSocket = onlineUsers.get(toUserId);

      if (targetSocket) {
        io.to(targetSocket).emit("friend:request:accepted", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          timestamp: new Date().toISOString(),
        });
      }
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const { roomId, userId, user } = socket.data;

      if (userId) {
        onlineUsers.delete(userId);
        micStates.delete(userId);

        if (roomId && typingUsers.has(roomId)) {
          typingUsers.get(roomId).delete(userId);
        }

        // 🔥 Remove from room users
        if (roomId && roomUsers.has(roomId)) {
          roomUsers.get(roomId).delete(userId);
        }
      }

      if (roomId && user) {
        socket.to(`room:${roomId}`).emit("room:userLeft", {
          userId: user.id,
        });
      }

      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  return {
    getMicStates: () => micStates,
    getRoomUsers: () => roomUsers,
    getOnlineUsers: () => onlineUsers,
  };
};
