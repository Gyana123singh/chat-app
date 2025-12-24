const Room = require("../models/room");

module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER CONNECT
    ========================== */
    socket.on("user:connect", ({ userId }) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;

      io.emit("user:online", { userId });
    });

    /* =========================
       ROOM JOIN (UUID SAFE)
    ========================== */
    socket.on("room:join", async ({ roomId, user }) => {
      if (!roomId || !user?.id) return;

      const roomName = `room:${roomId}`;

      // Prevent duplicate joins
      if (socket.data.roomId === roomId) return;

      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.user = {
        id: user.id,
        username: user.username,
        avatar: user.avatar || "/avatar.png",
      };

      // Fetch all sockets in this room
      const sockets = await io.in(roomName).fetchSockets();

      // Unique users (multi-tab safe)
      const usersInRoom = Array.from(
        new Map(
          sockets
            .map((s) => s.data.user)
            .filter(Boolean)
            .map((u) => [u.id, u])
        ).values()
      );

      // Send existing users to new joiner
      socket.emit("room:users", usersInRoom);

      // Notify others
      socket.to(roomName).emit("room:userJoined", socket.data.user);

      console.log(`👤 ${user.username} joined room ${roomId}`);
    });

    /* =========================
       ROOM LEAVE
    ========================== */
    socket.on("room:leave", async () => {
      await handleLeave(socket, io);
    });

    /* =========================
       DISCONNECT
    ========================== */
    socket.on("disconnect", async () => {
      console.log("❌ Socket disconnected:", socket.id);

      await handleLeave(socket, io);

      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          io.emit("user:offline", { userId });
          break;
        }
      }
    });

    /* =========================
       CHAT
    ========================== */
    socket.on("message:send", ({ roomId, content }) => {
      if (!roomId || !content) return;

      io.to(`room:${roomId}`).emit("message:receive", {
        content,
        userId: socket.data.user.id,
        username: socket.data.user.username,
        avatar: socket.data.user.avatar,
        timestamp: new Date(),
      });
    });

    /* =========================
       TYPING
    ========================== */
    socket.on("typing:start", ({ roomId }) => {
      socket.to(`room:${roomId}`).emit("typing:update", {
        userId: socket.data.user.id,
        username: socket.data.user.username,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ roomId }) => {
      socket.to(`room:${roomId}`).emit("typing:update", {
        userId: socket.data.user.id,
        username: socket.data.user.username,
        isTyping: false,
      });
    });

    /* =========================
       🎤 MIC
    ========================== */
    socket.on("mic:update", ({ speaking, muted }) => {
      if (!socket.data.roomId) return;

      io.to(`room:${socket.data.roomId}`).emit("mic:update", {
        userId: socket.data.user.id,
        speaking,
        muted,
      });
    });

    /* =========================
       🎁 GIFTS
    ========================== */
    socket.on("gift:send", ({ roomId, gift }) => {
      io.to(`room:${roomId}`).emit("gift:received", {
        ...gift,
        from: socket.data.user,
        timestamp: new Date(),
      });
    });

    /* =========================
       📞 WEBRTC SIGNALING
    ========================== */
    socket.on("call:initiate", ({ receiverId, offer }) => {
      const targetSocket = onlineUsers.get(receiverId);
      if (!targetSocket) return;

      io.to(targetSocket).emit("call:incoming", {
        from: socket.data.user,
        offer,
      });
    });

    socket.on("call:answer", ({ callerId, answer }) => {
      const targetSocket = onlineUsers.get(callerId);
      if (!targetSocket) return;

      io.to(targetSocket).emit("call:answered", {
        from: socket.data.user,
        answer,
      });
    });

    socket.on("call:ice-candidate", ({ to, candidate }) => {
      const targetSocket = onlineUsers.get(to);
      if (!targetSocket) return;

      io.to(targetSocket).emit("call:ice-candidate", {
        from: socket.data.user.id,
        candidate,
      });
    });
  });
};

/* =========================
   SAFE LEAVE HANDLER
========================== */
async function handleLeave(socket, io) {
  const { roomId, user } = socket.data;
  if (!roomId || !user) return;

  try {
    await Room.findOneAndUpdate(
      { roomId },
      { $pull: { participants: { user: user.id } } }
    );

    io.to(`room:${roomId}`).emit("room:userLeft", {
      userId: user.id,
    });

    socket.leave(`room:${roomId}`);
    socket.data.roomId = null;
  } catch (err) {
    console.error("❌ Leave error:", err.message);
  }
}
