const roomManager = require("../utils/musicRoomManager");
const VideoRoom = require("../models/videoRoom");
const Leaderboard = require("../models/trophyLeaderBoard");
const MusicState = require("../models/musicState");
const restoreMusicState = require("../utils/restoreMusicState");
const levelController = require("../controllers/levelController");

const mongoose = require("mongoose");

module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room
  // ===============================
  // WAFA LEVEL TIMERS (SAFE)
  // ===============================
  const roomStayTimers = new Map(); // userId -> interval
  const micExpTimers = new Map(); // userId -> interval

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

      socket.join(userId.toString()); // 🔥 ADD THIS LINE for CP
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
      // 🔥 Init music state safely (no overwrite if already playing)
      // ✅ CORRECT MUSIC STATE HANDLING
      roomManager.initRoom(roomId);
      await restoreMusicState(roomId);

      // Track users
      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set());
      }
      roomUsers.get(roomId).add(user.id);

      console.log(`📍 ${user.username} joined ${roomName}`);

      try {
        /* ===== VIDEO ROOM SYNC ===== */
        let videoRoom = await VideoRoom.findOne({ roomId });
        if (!videoRoom) {
          videoRoom = await VideoRoom.create({
            roomId,
            hostId: user.id, // just stored, no restriction
            video: { isVisible: false },
            audio: { isMixing: false },
            participants: [],
          });
        }

        await VideoRoom.findOneAndUpdate(
          { roomId },
          {
            $addToSet: {
              participants: {
                userId: user.id,
                role: "listener", // everyone equal
                isReceivingVideo: false,
                videoFPS: 0,
                videoLatency: 0,
                lastVideoFrameReceived: 0,
              },
            },
          },
          { new: true },
        );

        /* ===== USERS LIST ===== */
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

        /* ===== MESSAGES ===== */
        const messages = roomMessages.get(roomId) || [];
        socket.emit("room:messages", messages);

        /* ===== MUSIC STATE ===== */

        const currentMusicState = roomManager.getState(roomId);
        const currentPosition = roomManager.getCurrentPosition(roomId);
        const dbState = await MusicState.findOne({ roomId });

        const musicPayload = {
          musicFile: currentMusicState.musicFile,
          isPlaying: currentMusicState.isPlaying,
          startedAt: currentMusicState.startedAt, // ✅ FIX (IMPORTANT)
          currentPosition,
          playedBy: currentMusicState.playedBy,
          musicUrl: dbState?.musicUrl || null,
        };

        // ✅ ONLY SEND STATE (NO AUTOPLAY)
        socket.emit("room:musicState", musicPayload);

        /* ===== VIDEO STATE ===== */
        let currentTime = 0;

        if (videoRoom.video) {
          if (videoRoom.video.isPlaying && videoRoom.video.startedAt) {
            currentTime =
              (Date.now() - new Date(videoRoom.video.startedAt).getTime()) /
                1000 +
              (videoRoom.video.currentTime || 0);
          } else {
            currentTime = videoRoom.video.currentTime || 0;
          }
        }

        socket.emit("room:videoState", {
          video: {
            ...videoRoom.video.toObject(),
            currentTime,
          },
        });

        // ===============================
        // ⏱ 5 MIN STAY EXP (PERSONAL)
        // ===============================
        if (!roomStayTimers.has(user.id)) {
          const stayTimer = setInterval(
            async () => {
              try {
                await levelController.addPersonalExp(user.id, 10, io);

                io.to(user.id.toString()).emit("level:exp", {
                  type: "personal",
                  exp: 10,
                  message: "+10 EXP (5 min stay)",
                });
              } catch (e) {
                console.error("stay exp error:", e.message);
              }
            },
            5 * 60 * 1000,
          );

          roomStayTimers.set(user.id, stayTimer);
        }
      } catch (err) {
        console.error("❌ room:join error:", err);
      }
    });



    /* =========================
   VIDEO CONTROLS (ALL USERS)
========================= */

    socket.on("video:play", ({ roomId, userId }) => {
      if (!roomId) return;

      // ✅ socket only broadcasts (no DB write)
      io.to(`room:${roomId}`).emit("video:started", {
        startedBy: userId,
      });
    });

    socket.on("video:pause", ({ roomId }) => {
      if (!roomId) return;

      io.to(`room:${roomId}`).emit("video:paused");
    });

    socket.on("video:resume", ({ roomId }) => {
      if (!roomId) return;

      io.to(`room:${roomId}`).emit("video:resumed");
    });

    socket.on("video:stop", ({ roomId }) => {
      if (!roomId) return;

      io.to(`room:${roomId}`).emit("video:stopped");
    });

    /* =========================
   VIDEO STREAM SIGNALING (NEW)
========================= */

    // Host starts video streaming
    socket.on("video:stream:start", ({ roomId }) => {
      if (!roomId) return;

      console.log("🎬 Video stream start request:", roomId);

      // Notify all users in room to prepare WebRTC
      socket.to(`room:${roomId}`).emit("video:stream:ready", {
        from: socket.data.userId,
      });
    });

    // WebRTC Offer
    socket.on("video:webrtc:offer", ({ roomId, offer }) => {
      if (!roomId || !offer) return;

      socket.to(`room:${roomId}`).emit("video:webrtc:offer", {
        from: socket.data.userId,
        offer,
      });
    });

    // WebRTC Answer
    socket.on("video:webrtc:answer", ({ roomId, answer }) => {
      if (!roomId || !answer) return;

      socket.to(`room:${roomId}`).emit("video:webrtc:answer", {
        from: socket.data.userId,
        answer,
      });
    });

    // ICE Candidate
    socket.on("video:webrtc:ice", ({ roomId, candidate }) => {
      if (!roomId || !candidate) return;

      socket.to(`room:${roomId}`).emit("video:webrtc:ice", {
        from: socket.data.userId,
        candidate,
      });
    });

    /* =========================
       MIC CONTROLS
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
      if (micExpTimers.has(userId)) {
        clearInterval(micExpTimers.get(userId));
        micExpTimers.delete(userId);
      }
    });

    socket.on("mic:unmute", () => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      micStates.set(userId, { muted: false, speaking: false });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking: false,
      });
      if (micExpTimers.has(userId)) {
        clearInterval(micExpTimers.get(userId));
        micExpTimers.delete(userId);
      }
    });

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

      // ===============================
      // 🎤 10 MIN ROOM EXP (WAFA)
      // ===============================
      if (speaking === true && !micExpTimers.has(userId)) {
        const micTimer = setInterval(
          async () => {
            try {
              await levelController.addRoomExp(userId, 20, io);

              io.to(userId.toString()).emit("level:exp", {
                type: "room",
                exp: 20,
                message: "+20 Room EXP (10 min mic)",
              });
            } catch (err) {
              console.error("❌ mic EXP error:", err.message);
            }
          },
          10 * 60 * 1000,
        );

        micExpTimers.set(userId, micTimer);
      }

      // ❌ stop mic EXP when not speaking
      if (speaking === false && micExpTimers.has(userId)) {
        clearInterval(micExpTimers.get(userId));
        micExpTimers.delete(userId);
      }
    });

    /* =========================
       EMOJI
    ========================= */
    socket.on("send_emoji", ({ roomId, userId, emoji }) => {
      if (!roomId || !userId || !emoji) return;

      io.to(`room:${roomId}`).emit("receive_emoji", {
        userId,
        emoji,
        timestamp: Date.now(),
      });
    });

    /* =========================
       WEBRTC SIGNALING
    ========================= */
    socket.on("call:offer", ({ to, offer }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("call:offer", {
          from: socket.data.userId,
          offer,
        });
      }
    });

    socket.on("call:answer", ({ to, answer }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("call:answer", {
          from: socket.data.userId,
          answer,
        });
      }
    });

    socket.on("call:ice", ({ to, candidate }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("call:ice", {
          from: socket.data.userId,
          candidate,
        });
      }
    });

    /* =========================
       CHAT
    ========================= */
    socket.on("message:send", ({ roomId, text }) => {
      const { userId, username, avatar } = socket.data;
      if (!roomId || !text || !userId) return;

      const roomName = `room:${roomId}`;

      const message = {
        id: `${userId}-${Date.now()}`,
        userId,
        username,
        avatar,
        text,
        timestamp: new Date().toISOString(),
      };

      if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
      roomMessages.get(roomId).push(message);

      io.to(roomName).emit("message:receive", message);
    });

    socket.on("message:typing", ({ roomId, isTyping }) => {
      const { userId, username } = socket.data;
      if (!roomId || !userId) return;

      const roomName = `room:${roomId}`;

      if (!typingUsers.has(roomId)) typingUsers.set(roomId, new Set());

      const typingSet = typingUsers.get(roomId);
      if (isTyping) typingSet.add(userId);
      else typingSet.delete(userId);

      socket.to(roomName).emit("message:typing", {
        userId,
        username,
        isTyping,
        typingUsers: Array.from(typingSet),
      });
    });

    /* =========================
       TROPHY / LEADERBOARD
    ========================= */
    socket.on(
      "trophy:get-leaderboard",
      async ({ period = "daily", page = 1, limit = 20 }) => {
        try {
          if (!["daily", "weekly", "monthly", "allTime"].includes(period)) {
            return socket.emit("trophy:error", { message: "Invalid period" });
          }

          const skip = (page - 1) * limit;
          const leaderboard = await Leaderboard.find()
            .populate("userId", "username profile.avatar")
            .sort({ [`${period}.coins`]: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

          const formatted = leaderboard.map((entry, index) => ({
            rank: skip + index + 1,
            userId: entry.userId?._id,
            username: entry.userId?.username || "Unknown",
            avatar: entry.userId?.profile?.avatar || null,
            coins: entry[period].coins,
            level: entry.level || 1,
          }));

          socket.emit("trophy:leaderboard-data", {
            success: true,
            leaderboard: formatted,
            period,
          });
        } catch (err) {
          console.error("❌ trophy:get-leaderboard error:", err);
          socket.emit("trophy:error", {
            message: "Failed to fetch leaderboard",
          });
        }
      },
    );

    /* =========================
       FRIEND REQUEST
    ========================= */
    socket.on("friend:request:send", ({ toUserId }) => {
      const fromUserId = socket.data.userId;
      const targetSocket = onlineUsers.get(toUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("friend:request:received", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
        });
      }
    });

    socket.on("friend:request:accept", ({ toUserId }) => {
      const fromUserId = socket.data.userId;
      const targetSocket = onlineUsers.get(toUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("friend:request:accepted", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
        });
      }
    });

    /* =========================
       ROOM STATUS
    ========================= */
    socket.on("room:getUsersStatus", async ({ roomId }) => {
      if (!roomId) return;

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
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", async () => {
      const { roomId, userId, user } = socket.data;

      try {
        if (userId) {
          onlineUsers.delete(userId);
          micStates.delete(userId);
          // ===============================
          // 🔥 CLEAR LEVEL TIMERS (ALWAYS)
          // ===============================
          if (roomStayTimers.has(userId)) {
            clearInterval(roomStayTimers.get(userId));
            roomStayTimers.delete(userId);
          }

          if (micExpTimers.has(userId)) {
            clearInterval(micExpTimers.get(userId));
            micExpTimers.delete(userId);
          }
          if (roomId && typingUsers.has(roomId)) {
            typingUsers.get(roomId).delete(userId);
          }

          if (roomId && roomUsers.has(roomId)) {
            roomUsers.get(roomId).delete(userId);
          }

          const musicState = roomManager.getState(roomId);

          // 🔥 STOP MUSIC ONLY IF OWNER LEFT
          if (
            roomId &&
            musicState.isPlaying &&
            musicState.playedBy &&
            musicState.playedBy.toString() === userId.toString()
          ) {
            io.to(`room:${roomId}`).emit("music:stopped", {
              message: "Music owner left. Music stopped.",
            });

            roomManager.stopMusic(roomId);

            await MusicState.findOneAndUpdate(
              { roomId },
              {
                musicFile: null,
                musicUrl: null,
                isPlaying: false,
                pausedAt: 0,
                startedAt: null,
                localFilePath: null,
                playedBy: null,
              },
            );
          }
        }

        if (roomId && user) {
          socket
            .to(`room:${roomId}`)
            .emit("room:userLeft", { userId: user.id });
        }

        console.log("❌ Socket disconnected:", socket.id);
      } catch (err) {
        console.error("❌ Disconnect cleanup error:", err);
      }
    });
  });

  return {
    getMicStates: () => micStates,
    getRoomUsers: () => roomUsers,
    getOnlineUsers: () => onlineUsers,
    getRoomManager: () => roomManager,
  };
};
