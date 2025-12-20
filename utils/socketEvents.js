// utils/socketEvents.js
module.exports = (io) => {
  const onlineUsers = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // User connects
    socket.on("user:connect", async (data) => {
      const userId = data.userId;
      onlineUsers.set(userId, socket.id);

      io.emit("user:online", {
        userId,
        timestamp: new Date(),
      });

      console.log(`User ${userId} is online`);
    });

    // User disconnects
    socket.on("disconnect", async () => {
      let disconnectedUserId = null;

      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          disconnectedUserId = userId;
          onlineUsers.delete(userId);
          break;
        }
      }

      if (disconnectedUserId) {
        io.emit("user:offline", {
          userId: disconnectedUserId,
          timestamp: new Date(),
        });
        console.log(`User ${disconnectedUserId} is offline`);
      }
    });

    // Room events
    socket.on("room:join", (data) => {
      const { roomId, userId } = data;
      socket.join(`room:${roomId}`);

      io.to(`room:${roomId}`).emit("room:userJoined", {
        userId,
        roomId,
        timestamp: new Date(),
      });

      console.log(`User ${userId} joined room ${roomId}`);
    });

    socket.on("room:leave", (data) => {
      const { roomId, userId } = data;
      socket.leave(`room:${roomId}`);

      io.to(`room:${roomId}`).emit("room:userLeft", {
        userId,
        roomId,
        timestamp: new Date(),
      });

      console.log(`User ${userId} left room ${roomId}`);
    });

    // Message events
    socket.on("message:send", async (data) => {
      try {
        const { content, roomId, userId, username, avatar } = data;

        // Broadcast to room
        io.to(`room:${roomId}`).emit("message:receive", {
          content,
          roomId,
          userId,
          username,
          avatar,
          timestamp: new Date(),
        });

        console.log(`Message in room ${roomId}: ${content}`);
      } catch (error) {
        console.error("Message send error:", error);
      }
    });

    // Typing indicator
    socket.on("typing:start", (data) => {
      const { roomId, userId, username } = data;
      socket.to(`room:${roomId}`).emit("typing:update", {
        userId,
        username,
        isTyping: true,
      });
    });

    socket.on("typing:stop", (data) => {
      const { roomId, userId, username } = data;
      socket.to(`room:${roomId}`).emit("typing:update", {
        userId,
        username,
        isTyping: false,
      });
    });

    // Gift events
    socket.on("gift:send", (data) => {
      const { giftId, giftName, roomId, receiverId, senderId, senderName } =
        data;

      io.to(`room:${roomId}`).emit("gift:received", {
        giftId,
        giftName,
        receiverId,
        senderId,
        senderName,
        timestamp: new Date(),
      });

      console.log(`Gift sent in room ${roomId}`);
    });

    // User status update
    socket.on("user:statusUpdate", (data) => {
      const { userId, status } = data;
      io.emit("user:statusChanged", {
        userId,
        status,
        timestamp: new Date(),
      });
    });

    // Voice call events
    socket.on("call:initiate", (data) => {
      const { callerId, receiverId, offer } = data;
      const receiverSocketId = onlineUsers.get(receiverId);

      if (receiverSocketId) {
        io.to(receiverSocketId).emit("call:incoming", {
          callerId,
          offer,
        });
      }
    });

    socket.on("call:answer", (data) => {
      const { callerId, answer } = data;
      const callerSocketId = onlineUsers.get(callerId);

      if (callerSocketId) {
        io.to(callerSocketId).emit("call:answered", {
          answer,
        });
      }
    });

    socket.on("call:ice-candidate", (data) => {
      const { to, candidate } = data;
      const targetSocketId = onlineUsers.get(to);

      if (targetSocketId) {
        io.to(targetSocketId).emit("call:ice-candidate", {
          candidate,
        });
      }
    });

    // Error handling
    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });
  });
};
