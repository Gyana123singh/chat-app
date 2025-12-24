const Room = require("../models/room");

module.exports = (io) => {
  const onlineUsers = new Map();

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    socket.on("user:connect", ({ userId }) => {
      if (!userId) return;
      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;
      io.emit("user:online", { userId });
    });

    socket.on("room:join", async ({ roomId, user }) => {
      if (!roomId) return;

      const roomName = `room:${roomId}`;

      if (socket.data.roomId === roomId) return;

      socket.join(roomName);
      socket.data.roomId = roomId;
      socket.data.user = {
        id: user?.id || socket.data.userId,
        username: user?.username || "User",
        avatar: user?.avatar || "/avatar.png",
      };

      const sockets = await io.in(roomName).fetchSockets();
      const usersInRoom = Array.from(
        new Map(
          sockets
            .map((s) => s.data.user)
            .filter(Boolean)
            .map((u) => [u.id, u])
        ).values()
      );

      socket.emit("room:users", usersInRoom);
      socket.to(roomName).emit("room:userJoined", socket.data.user);

      console.log(`👤 ${socket.data.user.username} joined room ${roomId}`);
    });

    socket.on("room:leave", async () => {
      await handleLeave(socket, io);
    });

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

    /* ========================
       📞 WEBRTC SIGNALING
    ======================== */
    socket.on("call:offer", ({ roomId, offer, to }) => {
      io.to(`room:${roomId}`).emit("call:offer", {
        offer,
        from: socket.data.user.id,
        to,
      });
      console.log(`📤 Offer from ${socket.data.user.id} to ${to}`);
    });

    socket.on("call:answer", ({ roomId, answer, to }) => {
      io.to(`room:${roomId}`).emit("call:answer", {
        answer,
        from: socket.data.user.id,
        to,
      });
      console.log(`📤 Answer from ${socket.data.user.id} to ${to}`);
    });

    socket.on("call:ice", ({ roomId, candidate, to }) => {
      io.to(`room:${roomId}`).emit("call:ice", {
        candidate,
        from: socket.data.user.id,
        to,
      });
    });

    socket.on("mic:update", ({ speaking, muted }) => {
      if (!socket.data.roomId) return;
      io.to(`room:${socket.data.roomId}`).emit("mic:update", {
        userId: socket.data.user.id,
        speaking,
        muted,
      });
    });

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
  });
};

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
