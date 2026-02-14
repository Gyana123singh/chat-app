module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    socket.on("user:register", ({ userId }) => {
      if (!userId) return;
      socket.data.userId = userId;
      onlineUsers.set(userId.toString(), socket.id);
      console.log("🟢 User online:", userId);
    });

    // 🎁 Send gift animation to single user
    socket.on("gift:sendToUser", ({ receiverId, payload }) => {
      const senderId = socket.data.userId;
      if (!senderId || !receiverId || !payload) return;

      const receiverSocket = onlineUsers.get(receiverId.toString());
      if (receiverSocket) {
        io.to(receiverSocket).emit("gift:received", payload);
      }
    });

    // 🎁 Broadcast to room (for entrance effects etc)
    socket.on("gift:sendToRoom", ({ roomId, payload }) => {
      if (!roomId || !payload) return;
      io.to(`room:${roomId}`).emit("gift:animation", payload);
    });

    socket.on("disconnect", () => {
      if (socket.data.userId) {
        onlineUsers.delete(socket.data.userId.toString());
      }
      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  return {
    getOnlineUsers: () => onlineUsers,
  };
};
