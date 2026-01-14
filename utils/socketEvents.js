const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const VideoRoom = require("../models/videoRoom");
const Leaderboard = require("../models/trophyLeaderBoard");
const mongoose = require("mongoose");

module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room
  const hostUsers = new Map(); // roomId -> userId (track room host)

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
    socket.on("room:join", async ({ roomId, user, isHost }) => {
      if (!roomId || !user) return;

      const roomName = `room:${roomId}`;
      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.user = user;
      socket.data.isHost = isHost;

      // 🎵 Track host for music control
      if (isHost) {
        hostUsers.set(roomId, user.id);
      }

      // 🎵 Initialize room music state if first user
      if (!roomManager.roomMusicStates.has(roomId)) {
        roomManager.initRoom(roomId);
      }

      // Track users in room
      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set());
      }
      roomUsers.get(roomId).add(user.id);

      console.log(`📍 ${user.username} joined ${roomName}`);

      try {
        // ✅ FIX #2: SYNC VIDEOROOM ON JOIN
        if (!(await VideoRoom.findOne({ roomId }))) {
          await VideoRoom.create({
            roomId,
            hostId: socket.data.userId,
            video: { isVisible: false },
            audio: { isMixing: false },
          });
          console.log(`🎬 VideoRoom created for ${roomId}`);
        }

        // ✅ FIX #4: ADD PARTICIPANT TO VIDEOROOM
        await VideoRoom.findOneAndUpdate(
          { roomId },
          {
            $addToSet: {
              participants: {
                userId: user.id,
                role: isHost ? "host" : "listener",
                isReceivingVideo: false,
                videoFPS: 0,
                videoLatency: 0,
                lastVideoFrameReceived: 0,
              },
            },
          },
          { new: true }
        );

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

        // 🎵 Send current music state to newly joined user
        const currentMusicState = roomManager.getState(roomId);

        // Calculate current position for late joiners
        let currentPosition = 0;
        if (currentMusicState.isPlaying && currentMusicState.startedAt) {
          currentPosition = roomManager.getCurrentPosition(roomId);
        } else if (!currentMusicState.isPlaying) {
          currentPosition = currentMusicState.pausedAt;
        }

        socket.emit("room:musicState", {
          musicFile: currentMusicState.musicFile,
          isPlaying: currentMusicState.isPlaying,
          currentPosition: currentPosition,
          pausedAt: currentMusicState.pausedAt,
          startedAt: currentMusicState.startedAt,
        });

        // 🎬 Send current video state to newly joined user
        const videoRoom = await VideoRoom.findOne({ roomId });
        if (videoRoom) {
          socket.emit("room:videoState", {
            video: videoRoom.video,
            frameSync: videoRoom.frameSync,
            stats: videoRoom.stats,
          });
        }
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
     SEND EMOJI
   ========================= */
    socket.on("send_emoji", async (data) => {
      const { roomId, userId, emoji } = data;

      if (!roomId || !userId || !emoji) return;

      io.to("room:" + roomId).emit("receive_emoji", {
        // ✅ FIXED ROOM NAME
        userId,
        emoji,
        timestamp: Date.now(),
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
       🎵 MUSIC: PLAY
    ========================= */
    socket.on("music:play", async ({ roomId, musicFile }) => {
      const { userId, isHost } = socket.data;
      if (!isHost || !roomId || !musicFile) {
        socket.emit("music:error", { message: "Only host can control music" });
        return;
      }

      const roomName = `room:${roomId}`;

      try {
        // Update in-memory state
        const newState = roomManager.playMusic(roomId, musicFile);

        // Save to database for persistence
        await MusicState.findOneAndUpdate(
          { roomId },
          {
            roomId,
            musicFile,
            isPlaying: true,
            startedAt: new Date(newState.startedAt),
            pausedAt: 0,
            hostId: userId,
          },
          { upsert: true }
        );

        // ✅ STANDARDIZED TIMESTAMP (FIX #7)
        io.to(roomName).emit("music:playing", {
          musicFile,
          startedAt: Date.now(),
          currentPosition: 0,
          timestamp: Date.now(),
        });

        console.log(`🎵 Music started in ${roomName}:`, musicFile.name);
      } catch (error) {
        console.error("❌ music:play error:", error.message);
        socket.emit("music:error", { message: "Failed to start music" });
      }
    });

    /* =========================
       🎵 MUSIC: PAUSE
    ========================= */
    socket.on("music:pause", async ({ roomId, pausedAt }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("music:error", { message: "Only host can control music" });
        return;
      }

      const roomName = `room:${roomId}`;

      try {
        const newState = roomManager.pauseMusic(roomId, pausedAt);

        await MusicState.findOneAndUpdate(
          { roomId },
          {
            isPlaying: false,
            pausedAt: pausedAt,
          }
        );

        io.to(roomName).emit("music:paused", {
          pausedAt: pausedAt,
          timestamp: Date.now(),
        });

        console.log(`⏸️ Music paused in ${roomName} at ${pausedAt}ms`);
      } catch (error) {
        console.error("❌ music:pause error:", error.message);
        socket.emit("music:error", { message: "Failed to pause music" });
      }
    });

    /* =========================
       🎵 MUSIC: RESUME
    ========================= */
    socket.on("music:resume", async ({ roomId }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("music:error", { message: "Only host can control music" });
        return;
      }

      const roomName = `room:${roomId}`;

      try {
        const newState = roomManager.resumeMusic(roomId);

        await MusicState.findOneAndUpdate(
          { roomId },
          {
            isPlaying: true,
            startedAt: new Date(newState.startedAt),
            pausedAt: 0,
          }
        );

        io.to(roomName).emit("music:resumed", {
          resumeFrom: newState.pausedAt,
          startedAt: Date.now(),
          timestamp: Date.now(),
        });

        console.log(`▶️ Music resumed in ${roomName}`);
      } catch (error) {
        console.error("❌ music:resume error:", error.message);
        socket.emit("music:error", { message: "Failed to resume music" });
      }
    });

    /* =========================
       🎵 MUSIC: STOP
    ========================= */
    socket.on("music:stop", async ({ roomId }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("music:error", { message: "Only host can control music" });
        return;
      }

      const roomName = `room:${roomId}`;

      try {
        roomManager.stopMusic(roomId);

        await MusicState.findOneAndUpdate(
          { roomId },
          {
            musicFile: null,
            isPlaying: false,
            pausedAt: 0,
            startedAt: null,
          }
        );

        io.to(roomName).emit("music:stopped", {
          timestamp: Date.now(),
        });

        // ✅ FIX #5: CLEANUP ON MUSIC STOP
        await VideoRoom.deleteOne({ roomId });
        hostUsers.delete(roomId);
        roomUsers.delete(roomId);
        roomMessages.delete(roomId);
        typingUsers.delete(roomId);

        console.log(`⏹️ Music stopped in ${roomName}`);
      } catch (error) {
        console.error("❌ music:stop error:", error.message);
        socket.emit("music:error", { message: "Failed to stop music" });
      }
    });

    /* =========================
       🎵 MUSIC: SEEK
    ========================= */
    socket.on("music:seek", async ({ roomId, position }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("music:error", { message: "Only host can control music" });
        return;
      }

      const roomName = `room:${roomId}`;

      try {
        const newState = roomManager.seekMusic(roomId, position);

        await MusicState.findOneAndUpdate(
          { roomId },
          {
            startedAt: newState.isPlaying ? new Date(newState.startedAt) : null,
            pausedAt: newState.pausedAt,
          }
        );

        io.to(roomName).emit("music:seeked", {
          position: position,
          timestamp: Date.now(),
        });

        console.log(`⏭️ Seeked to ${position}ms in ${roomName}`);
      } catch (error) {
        console.error("❌ music:seek error:", error.message);
        socket.emit("music:error", { message: "Failed to seek" });
      }
    });

    /* =========================
       🎵 GET MUSIC STATE (for UI)
    ========================= */
    socket.on("music:getState", ({ roomId }) => {
      if (!roomId) return;

      const state = roomManager.getState(roomId);
      const currentPosition = roomManager.getCurrentPosition(roomId);

      socket.emit("music:state", {
        musicFile: state.musicFile,
        isPlaying: state.isPlaying,
        currentPosition: currentPosition,
      });
    });

    /* =========================
       🎬 VIDEO: INITIALIZE
    ========================= */
    socket.on("video:init", async ({ roomId, videoMetadata }) => {
      const { userId, isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("video:error", { message: "Only host can control video" });
        return;
      }

      try {
        // ✅ FIX #2: ENSURE VIDEOROOM EXISTS
        let videoRoom = await VideoRoom.findOne({ roomId });
        if (!videoRoom) {
          videoRoom = await VideoRoom.create({
            roomId,
            hostId: userId,
            video: { ...videoMetadata, isVisible: true },
            audio: { isMixing: false },
          });
        } else {
          videoRoom = await VideoRoom.findOneAndUpdate(
            { roomId },
            { $set: { video: { ...videoMetadata, isVisible: true } } },
            { new: true }
          );
        }

        const roomName = `room:${roomId}`;
        io.to(roomName).emit("video:initialized", {
          videoMetadata,
          timestamp: Date.now(),
        });

        console.log(`🎬 Video initialized in ${roomName}`);
      } catch (error) {
        console.error("❌ video:init error:", error);
        socket.emit("video:error", { message: "Failed to initialize video" });
      }
    });

    /* =========================
       🎬 VIDEO: PLAY
    ========================= */
    socket.on("video:play", async ({ roomId }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("video:error", { message: "Only host can control video" });
        return;
      }

      try {
        const videoRoom = await VideoRoom.findOneAndUpdate(
          { roomId },
          {
            "video.isPlaying": true,
            "video.isPaused": false,
            "video.startedAt": new Date(),
            "video.lastSyncTime": new Date(),
          },
          { new: true }
        );

        if (!videoRoom) {
          socket.emit("video:error", { message: "Video room not found" });
          return;
        }

        const roomName = `room:${roomId}`;
        io.to(roomName).emit("video:play", {
          currentTime: videoRoom.video.currentTime || 0,
          timestamp: Date.now(),
        });

        console.log(`▶️ Video playing in room:${roomId}`);
      } catch (error) {
        console.error("❌ video:play error:", error);
        socket.emit("video:error", { message: "Failed to play video" });
      }
    });

    /* =========================
       🎬 VIDEO: PAUSE
    ========================= */
    socket.on("video:pause", async ({ roomId, currentTime }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("video:error", { message: "Only host can control video" });
        return;
      }

      try {
        const videoRoom = await VideoRoom.findOneAndUpdate(
          { roomId },
          {
            "video.isPlaying": false,
            "video.isPaused": true,
            "video.pausedAt": new Date(),
            "video.currentTime": currentTime || 0,
            "video.lastSyncTime": new Date(),
          },
          { new: true }
        );

        if (!videoRoom) {
          socket.emit("video:error", { message: "Video room not found" });
          return;
        }

        const roomName = `room:${roomId}`;
        io.to(roomName).emit("video:pause", {
          currentTime: currentTime || 0,
          timestamp: Date.now(),
        });

        console.log(`⏸️ Video paused in room:${roomId}`);
      } catch (error) {
        console.error("❌ video:pause error:", error);
        socket.emit("video:error", { message: "Failed to pause video" });
      }
    });

    /* =========================
       🎬 VIDEO: FRAME DATA (WITH FIX #3: VALIDATION)
    ========================= */
    socket.on("video:frameData", async ({ roomId, frameData, frameNumber }) => {
      const { isHost } = socket.data;
      if (!isHost || !roomId) {
        socket.emit("video:error", {
          message: "Only host can send frame data",
        });
        return;
      }

      try {
        // ✅ FIX #3: VALIDATE FRAME SIZE
        const frameSize = JSON.stringify(frameData).length;
        const MAX_FRAME_SIZE = 5 * 1024 * 1024; // 5MB per frame

        if (frameSize > MAX_FRAME_SIZE) {
          socket.emit("video:error", {
            message: `Frame too large: ${Math.round(
              frameSize / 1024 / 1024
            )}MB > 5MB limit`,
          });
          console.warn(
            `❌ Frame rejected - size ${frameSize} bytes exceeds limit`
          );
          return;
        }

        const roomName = `room:${roomId}`;
        socket.to(roomName).emit("video:frameReceived", {
          frameData,
          frameNumber,
          timestamp: Date.now(),
        });

        console.log(
          `📤 Frame ${frameNumber} sent in room:${roomId} (${Math.round(
            frameSize / 1024
          )}KB)`
        );
      } catch (error) {
        console.error("❌ video:frameData error:", error);
        socket.emit("video:error", { message: "Failed to send frame data" });
      }
    });

    /* =========================
       🎬 VIDEO: GET STATE
    ========================= */
    socket.on("video:getState", async ({ roomId }) => {
      try {
        const videoRoom = await VideoRoom.findOne({ roomId });
        if (!videoRoom) {
          socket.emit("video:state", {});
          return;
        }

        socket.emit("video:state", {
          video: videoRoom.video,
          frameSync: videoRoom.frameSync,
          stats: videoRoom.stats,
          participants: videoRoom.participants,
        });
      } catch (error) {
        console.error("❌ video:getState error:", error);
        socket.emit("video:state", {});
      }
    });

    /* =========================
       🔥 GIFT SEND - REAL-TIME
    ========================= */
    socket.on("gift:send", async ({ roomId, giftData, sendType }) => {
      const { userId, username, avatar } = socket.data;
      if (!roomId || !userId || !giftData) return;

      const roomName = `room:${roomId}`;

      try {
        // 🔥 Get all users in room based on sendType
        let recipientIds = [];

        if (sendType === "individual") {
          recipientIds = giftData.recipientIds || [];
        } else if (sendType === "all_in_room") {
          // All users currently in room
          recipientIds = Array.from(roomUsers.get(roomId) || []);
        } else if (sendType === "all_on_mic") {
          // Only users currently speaking
          const roomUserIds = Array.from(roomUsers.get(roomId) || []);
          recipientIds = roomUserIds.filter(
            (uid) => micStates.get(uid)?.speaking === true
          );
        }

        // Remove sender from recipients
        recipientIds = recipientIds.filter(
          (id) => id.toString() !== userId.toString()
        );

        if (recipientIds.length === 0) {
          socket.emit("gift:error", {
            message: "No valid recipients found",
          });
          return;
        }

        // 🔥 Emit gift animation to all users in room
        io.to(roomName).emit("gift:received", {
          senderId: userId,
          senderUsername: username,
          senderAvatar: avatar,
          giftName: giftData.name,
          giftIcon: giftData.icon,
          giftPrice: giftData.price,
          giftRarity: giftData.rarity,
          sendType,
          recipientCount: recipientIds.length,
          totalCoinsTransferred: giftData.price * recipientIds.length,
          timestamp: new Date().toISOString(),
          animation: true,
        });

        console.log(`🎁 Gift "${giftData.name}" sent in ${roomName}:`, {
          sender: username,
          recipientCount: recipientIds.length,
          sendType,
          totalCoins: giftData.price * recipientIds.length,
        });
      } catch (error) {
        console.error("❌ gift:send error:", error.message);
        socket.emit("gift:error", {
          message: "Error sending gift",
          error: error.message,
        });
      }
    });

    /**
     * 🏆 REQUEST: Get leaderboard data
     * Client sends: { period: "daily", page: 1, limit: 20 }
     */
    socket.on("trophy:get-leaderboard", async (data) => {
      try {
        const { period = "daily", page = 1, limit = 20 } = data || {};

        // ✅ FIX #1: Validate period
        if (!["daily", "weekly", "monthly", "allTime"].includes(period)) {
          return socket.emit("trophy:error", {
            success: false,
            message: "Invalid period",
          });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortField = `${period}.coins`;

        // ✅ FIX #2: Standardized model import
        const leaderboard = await Leaderboard.find()
          .populate("userId", "username profile.avatar")
          .sort({ [sortField]: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean();

        // ✅ FIX #3: Format response consistently with HTTP endpoint
        const formattedLeaderboard = leaderboard.map((entry, index) => ({
          rank: skip + index + 1,
          userId: entry.userId?._id,
          username: entry.userId?.username || "Unknown",
          avatar: entry.userId?.profile?.avatar || null,
          coins: entry[period].coins,
          giftsReceived: entry[period].giftsReceived,
          totalValue: entry[period].totalValue,
          level: entry.level || 1,
        }));

        const totalCount = await Leaderboard.countDocuments();

        socket.emit("trophy:leaderboard-data", {
          success: true,
          leaderboard: formattedLeaderboard,
          period,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalCount,
            pages: Math.ceil(totalCount / parseInt(limit)),
          },
        });
      } catch (error) {
        console.error("❌ trophy:get-leaderboard error:", error.message);
        socket.emit("trophy:error", {
          success: false,
          message: "Failed to fetch leaderboard",
          error: error.message,
        });
      }
    });

    /**
     * 🏆 REQUEST: Get top 10 contributors
     * Client sends: { period: "daily" }
     */
    socket.on("trophy:get-top-contributors", async (data) => {
      try {
        const { period = "daily" } = data || {};

        if (!["daily", "weekly", "monthly", "allTime"].includes(period)) {
          return socket.emit("trophy:error", {
            success: false,
            message: "Invalid period",
          });
        }

        const top = await Leaderboard.find()
          .populate("userId", "username profile.avatar")
          .sort({ [`${period}.coins`]: -1 })
          .limit(10)
          .lean();

        const formatted = top.map((entry, index) => ({
          rank: index + 1,
          userId: entry.userId?._id,
          username: entry.userId?.username || "Unknown",
          avatar: entry.userId?.profile?.avatar || null,
          coins: entry[period].coins,
          giftsReceived: entry[period].giftsReceived,
          level: entry.level || 1,
        }));

        socket.emit("trophy:top-contributors-data", {
          success: true,
          topContributors: formatted,
          period,
        });
      } catch (error) {
        console.error("❌ trophy:get-top-contributors error:", error.message);
        socket.emit("trophy:error", {
          success: false,
          message: "Failed to fetch top contributors",
          error: error.message,
        });
      }
    });

    /**
     * 🎁 BROADCAST: Notify all users when gift is sent
     * This is emitted from sendGift controller via global.io.emit()
     * All clients listen to this event for real-time leaderboard updates
     */
    socket.on("gift:sent-notify", (data) => {
      // ✅ FIX #4: Proper validation before broadcast
      if (!data || !data.gifterUsername) {
        console.warn("Invalid gift:sent-notify data:", data);
        return;
      }

      const { gifterUsername, gifterUserId, recipientCount, totalCoins } = data;

      // Broadcast to ALL connected clients
      io.emit("leaderboard:updated", {
        success: true,
        message: `${gifterUsername} sent gifts to ${recipientCount} user(s)!`,
        gifterUserId,
        totalCoins,
        recipientCount,
        timestamp: new Date(),
      });

      console.log(
        `🎁 Gift broadcast: ${gifterUsername} → ${recipientCount} users (${totalCoins} coins)`
      );
    });

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

    // Handle store gift send event
    socket.on("sendGift", (data) => {
      const { receiverId, giftName, senderName } = data;
      io.to(receiverId).emit("giftNotification", {
        message: `${senderName} sent you a gift: ${giftName}`,
        data: data,
      });
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

        // 🎵 Handle music if host disconnects
        if (roomId && hostUsers.get(roomId) === userId) {
          const state = roomManager.getState(roomId);
          if (state.isPlaying) {
            const roomName = `room:${roomId}`;
            io.to(roomName).emit("music:hostDisconnected", {
              message: "Host disconnected. Music stopped.",
            });
            roomManager.stopMusic(roomId);
          }
          hostUsers.delete(roomId);
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
    getRoomManager: () => roomManager,
  };
};
