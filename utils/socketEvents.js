const Room = require("../models/room");

module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER CONNECT
    ========================= */
    socket.on("user:connect", ({ userId, username, avatar }) => {
      if (!userId) {
        console.error("❌ user:connect - No userId provided");
        return;
      }

      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      console.log("🟢 User registered:", {
        userId,
        socketId: socket.id,
        username,
      });
    });

    /* =========================
       ROOM JOIN
    ========================= */
    socket.on("room:join", async ({ roomId, user }) => {
      if (!roomId || !user) {
        console.error("❌ room:join - Missing roomId or user");
        return;
      }

      const roomName = `room:${roomId}`;

      socket.join(roomName);
      socket.data.roomId = roomId;
      socket.data.user = user;

      console.log(`📍 Joined room: ${roomName}`, {
        userId: user.id,
        socketId: socket.id,
      });

      try {
        const sockets = await io.in(roomName).fetchSockets();

        const usersInRoom = sockets
          .filter((s) => s.data.user && s.id !== socket.id)
          .map((s) => s.data.user);

        console.log(`📋 Existing users in room ${roomId}:`, usersInRoom);

        socket.emit("room:users", usersInRoom);

        socket.to(roomName).emit("room:userJoined", user);

        console.log(`✅ ${user.username} joined room ${roomId}`);
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

      micStates.set(userId, {
        muted: true,
        speaking: false,
      });

      console.log(`🔇 ${userId} muted mic`);

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: true,
        speaking: false,
      });
    });

    /* =========================
       MIC UNMUTE
    ========================= */
    socket.on("mic:unmute", () => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      micStates.set(userId, {
        muted: false,
        speaking: false,
      });

      console.log(`🎤 ${userId} unmuted mic`);

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking: false,
      });
    });

    /* =========================
       SPEAKING STATUS
    ========================= */
    socket.on("mic:speaking", (speaking) => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      const state = micStates.get(userId);
      if (!state || state.muted) return;

      micStates.set(userId, {
        ...state,
        speaking,
      });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking,
      });
    });

    /* =========================
       WEBRTC SIGNALING - OFFER
    ========================= */
    socket.on("call:offer", ({ to, offer }) => {
      console.log(
        `📤 Offer received from ${socket.data.userId} → sending to ${to}`
      );

      const targetSocketId = onlineUsers.get(to);

      if (!targetSocketId) {
        console.error(
          `❌ Target user ${to} not found. Online users:`,
          Array.from(onlineUsers.keys())
        );
        return;
      }

      console.log(`✅ Sending offer to socket: ${targetSocketId}`);

      io.to(targetSocketId).emit("call:offer", {
        offer,
        from: socket.data.userId,
      });
    });

    /* =========================
       WEBRTC SIGNALING - ANSWER
    ========================= */
    socket.on("call:answer", ({ to, answer }) => {
      console.log(
        `📤 Answer received from ${socket.data.userId} → sending to ${to}`
      );

      const targetSocketId = onlineUsers.get(to);

      if (!targetSocketId) {
        console.error(
          `❌ Target user ${to} not found. Online users:`,
          Array.from(onlineUsers.keys())
        );
        return;
      }

      console.log(`✅ Sending answer to socket: ${targetSocketId}`);

      io.to(targetSocketId).emit("call:answer", {
        answer,
        from: socket.data.userId,
      });
    });

    /* =========================
       WEBRTC SIGNALING - ICE CANDIDATE
    ========================= */
    socket.on("call:ice", ({ to, candidate }) => {
      console.log(
        `❄️ ICE candidate from ${socket.data.userId} → sending to ${to}`
      );

      const targetSocketId = onlineUsers.get(to);

      if (!targetSocketId) {
        console.warn(
          `⚠️ Target user ${to} not found for ICE. Online users:`,
          Array.from(onlineUsers.keys())
        );
        return;
      }

      console.log(`✅ Sending ICE candidate to socket: ${targetSocketId}`);

      io.to(targetSocketId).emit("call:ice", {
        candidate,
        from: socket.data.userId,
      });
    });

    /* =========================
       MIC UPDATE
    ========================= */
    socket.on("mic:update", ({ speaking, muted }) => {
      if (!socket.data.roomId || !socket.data.userId) return;

      console.log(`🎤 Mic update from ${socket.data.userId}:`, {
        speaking,
        muted,
      });

      socket.to(`room:${socket.data.roomId}`).emit("mic:update", {
        userId: socket.data.userId,
        speaking,
        muted,
      });
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const { roomId, user, userId } = socket.data;

      if (roomId && user) {
        console.log(`👤 User disconnecting from ${roomId}: ${user.username}`);
        socket.to(`room:${roomId}`).emit("room:userLeft", {
          userId: user.id,
        });
      }

      onlineUsers.delete(userId);
      console.log("❌ Socket disconnected:", socket.id);
    });
  });
};