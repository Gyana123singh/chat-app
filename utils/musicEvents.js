const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    socket.on("user:connect", ({ userId, username, avatar }) => {
      if (!userId) return;
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;
      console.log("🟢 User connected:", { userId, username });
    });

    socket.on("room:join", async ({ roomId, user, isHost }) => {
      if (!roomId || !user) return;

      const roomName = `room:${roomId}`;
      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.user = user;
      socket.data.isHost = isHost;

      // Initialize room if first user
      if (!roomManager.roomMusicStates.has(roomId)) {
        roomManager.initRoom(roomId);
      }

      console.log(`📍 ${user.username} joined ${roomName}`);

      try {
        // Send current music state to newly joined user
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

        // Notify others
        socket.to(roomName).emit("room:userJoined", user);
      } catch (err) {
        console.error("❌ room:join error:", err);
      }
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

        // Broadcast to all listeners
        io.to(roomName).emit("music:playing", {
          musicFile,
          startedAt: newState.startedAt,
          currentPosition: 0,
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
          startedAt: newState.startedAt,
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
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const { roomId, userId } = socket.data;

      if (roomId) {
        const state = roomManager.getState(roomId);
        if (state.isPlaying) {
          const roomName = `room:${roomId}`;
          io.to(roomName).emit("music:hostDisconnected", {
            message: "Host disconnected. Music stopped.",
          });
          roomManager.stopMusic(roomId);
        }
      }

      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  return {
    getRoomManager: () => roomManager,
  };
};
