// config/socket.js
const Room = require("../models/room.model");

module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    /* =========================
       USER ONLINE / OFFLINE
    ========================== */
    socket.on("user:connect", ({ userId }) => {
      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;

      io.emit("user:online", {
        userId,
        timestamp: new Date(),
      });
    });

    /* =========================
       ROOM JOIN
    ========================== */
    socket.on("room:join", async ({ roomId, user }) => {
      socket.join(`room:${roomId}`);

      socket.data.roomId = roomId;
      socket.data.userId = user.id;

      io.to(`room:${roomId}`).emit("room:userJoined", {
        user,
        timestamp: new Date(),
      });
    });

    /* =========================
       ROOM LEAVE (MANUAL)
    ========================== */
    socket.on("room:leave", async () => {
      await handleLeave(socket, io);
    });

    /* =========================
       AUTO LEAVE ON DISCONNECT
    ========================== */
    socket.on("disconnect", async () => {
      console.log("User disconnected:", socket.id);

      await handleLeave(socket, io);

      // Online map cleanup
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);

          io.emit("user:offline", {
            userId,
            timestamp: new Date(),
          });
          break;
        }
      }
    });

    /* =========================
       MESSAGES
    ========================== */
    socket.on("message:send", ({ content, roomId, userId, username, avatar }) => {
      io.to(`room:${roomId}`).emit("message:receive", {
        content,
        userId,
        username,
        avatar,
        timestamp: new Date(),
      });
    });

    /* =========================
       TYPING INDICATOR
    ========================== */
    socket.on("typing:start", ({ roomId, userId, username }) => {
      socket.to(`room:${roomId}`).emit("typing:update", {
        userId,
        username,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ roomId, userId, username }) => {
      socket.to(`room:${roomId}`).emit("typing:update", {
        userId,
        username,
        isTyping: false,
      });
    });

    /* =========================
       GIFTS
    ========================== */
    socket.on("gift:send", (data) => {
      io.to(`room:${data.roomId}`).emit("gift:received", {
        ...data,
        timestamp: new Date(),
      });
    });

    /* =========================
       🎤 MIC / SPEAKING
    ========================== */
    socket.on("mic:speaking", ({ isSpeaking }) => {
      io.to(`room:${socket.data.roomId}`).emit("mic:update", {
        userId: socket.data.userId,
        isSpeaking,
      });
    });

    /* =========================
       HOST CONTROLS
    ========================== */
    socket.on("host:mute", ({ targetUserId }) => {
      io.to(`room:${socket.data.roomId}`).emit("user:muted", targetUserId);
    });

    socket.on("host:kick", ({ targetUserId }) => {
      io.to(`room:${socket.data.roomId}`).emit("user:kicked", targetUserId);
    });

    /* =========================
       VOICE CALL (WEBRTC)
    ========================== */
    socket.on("call:initiate", ({ callerId, receiverId, offer }) => {
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("call:incoming", {
          callerId,
          offer,
        });
      }
    });

    socket.on("call:answer", ({ callerId, answer }) => {
      const callerSocketId = onlineUsers.get(callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit("call:answered", { answer });
      }
    });

    socket.on("call:ice-candidate", ({ to, candidate }) => {
      const targetSocketId = onlineUsers.get(to);
      if (targetSocketId) {
        io.to(targetSocketId).emit("call:ice-candidate", { candidate });
      }
    });

    /* =========================
       ERROR
    ========================== */
    socket.on("error", (err) => {
      console.error("Socket error:", err);
    });
  });
};

/* =========================
   LEAVE HANDLER
========================== */
async function handleLeave(socket, io) {
  const { roomId, userId } = socket.data;
  if (!roomId || !userId) return;

  try {
    const room = await Room.findById(roomId);
    if (!room) return;

    room.participants = room.participants.filter(
      (p) => p.user.toString() !== userId
    );

    room.stats.activeUsers = room.participants.length;
    await room.save();

    io.to(`room:${roomId}`).emit("room:userLeft", {
      userId,
      timestamp: new Date(),
    });

    socket.leave(`room:${roomId}`);
  } catch (err) {
    console.error("Leave room error:", err.message);
  }
}
