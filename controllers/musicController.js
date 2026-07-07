const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");
const path = require("path");
const mongoose = require("mongoose");
const RoomMusic = require("../models/musicRoom");
const Room = require("../models/room");
const convertToMp3 = require("../utils/convertAudio");
const cloudinary = require("../config/cloudinary");
const User = require("../models/users");

// Helper function to sync room music state to all participants
const broadcastMusicState = async (roomId, io) => {
  try {
    const state = roomManager.getState(roomId);
    const dbState = await MusicState.findOne({ roomId });
    const playlist = await RoomMusic.find({ roomId }).sort({ createdAt: 1 });

    const payload = {
      roomId,
      currentTrackId: dbState?.currentTrackId ? dbState.currentTrackId.toString() : null,
      currentPosition: roomManager.getCurrentPosition(roomId),
      isPlaying: state.isPlaying,
      startedAt: state.startedAt,
      pausedAt: state.pausedAt,
      trackOwnerId: dbState?.trackOwnerId ? dbState.trackOwnerId.toString() : null,
      playlist: playlist.map((m) => ({
        id: m._id.toString(),
        uploaderId: m.uploadedBy.toString(),
        uploaderUsername: m.uploaderUsername || "User",
        originalName: m.originalName,
        musicUrl: m.musicUrl,
        cloudinaryPublicId: m.cloudinaryPublicId,
        duration: m.duration || 0,
        uploadedAt: m.createdAt,
      })),
      playedBy: state.playedBy,
      musicFile: state.musicFile,
      musicUrl: dbState?.musicUrl || null,
    };

    io.to(`room:${roomId}`).emit("music:sync", payload);
    io.to(`room:${roomId}`).emit("room:musicState", payload);
    return payload;
  } catch (err) {
    console.error("❌ broadcastMusicState error:", err.message);
  }
};

// Middleware/Helper to validate uploader ownership
const validateOwnership = async (roomId, userId) => {
  // 1. Check if user is Host or Admin of the room
  try {
    const room = await Room.findOne({ roomId }).select("host participants").lean();
    if (room) {
      const isHost = room.host && room.host.toString() === userId.toString();
      const isAdmin = room.participants && room.participants.some(p => p.user && p.user.toString() === userId.toString() && p.role === "admin");
      if (isHost || isAdmin) {
        return true;
      }
    }
  } catch (err) {
    console.error("❌ validateOwnership room check error:", err);
  }

  const dbState = await MusicState.findOne({ roomId });
  if (!dbState || !dbState.currentTrackId) return true; // No active track, allowed

  // 2. Check if user is the current DJ (playedBy) or track owner (trackOwnerId)
  const isPlayedBy = dbState.playedBy && dbState.playedBy.toString() === userId.toString();
  const isTrackOwner = dbState.trackOwnerId && dbState.trackOwnerId.toString() === userId.toString();

  if (isPlayedBy || isTrackOwner) {
    return true;
  }

  return false;
};

/* ============================
   UPLOAD MUSIC (DJ LOCK)
============================ */
exports.uploadMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const userId = req.body.userId || req.headers["userid"];
    const duration = req.body.duration ? Number(req.body.duration) : 0;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    roomManager.initRoom(roomId);

    // Fetch user username for playlist metadata
    const dbUser = await User.findById(userId).select("username").lean();
    const uploaderUsername = dbUser?.username || "User";

    // 🔒 BLOCK IF SESSION ACTIVE (PLAYING OR PAUSED)
    const currentState = await MusicState.findOne({ roomId });
    if (currentState?.isPlaying) {
      return res.status(403).json({
        error: "Music session active. Please wait.",
      });
    }

    let filePath = req.file.path;
    let filename = req.file.filename;
    let originalname = req.file.originalname;
    const size = req.file.size;

    // OPUS → MP3
    if (
      req.file.mimetype.includes("opus") ||
      originalname.toLowerCase().endsWith(".opus")
    ) {
      const mp3Path = await convertToMp3(filePath);
      await fs.remove(filePath);

      filePath = mp3Path;
      filename = path.basename(mp3Path);
      originalname = originalname.replace(/\.opus$/i, ".mp3");
    }

    const uploadResult = await cloudinary.uploader.upload(filePath, {
      resource_type: "video", // REQUIRED for audio
      folder: `room-music/${roomId}`,
    });
    await fs.remove(filePath); // 🔥 REQUIRED
    const { secure_url, public_id } = uploadResult;

    const musicUrl = secure_url;

    const roomMusicDoc = await RoomMusic.create({
      roomId,
      fileName: filename,
      originalName: originalname,
      fileSize: size,
      cloudinaryPublicId: public_id,
      musicUrl,
      uploadedBy: userId,
      uploaderUsername,
      duration,
    });

    // Make uploaded song the current active track (or preserve state)
    await MusicState.findOneAndUpdate(
      { roomId },
      {
        roomId,
        musicFile: { name: originalname, fileSize: size },
        musicUrl, // Cloudinary URL
        localFilePath: null,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: userId,
        currentTrackId: roomMusicDoc._id,
        trackOwnerId: userId,
        duration,
      },
      { upsert: true },
    );

    // Broadcast to room
    await broadcastMusicState(roomId, io);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ uploadMusic:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   PLAY MUSIC (DJ ONLY)
============================ */
exports.playMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    roomManager.initRoom(roomId);

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState) {
      return res.status(400).json({ error: "Music not ready yet" });
    }

    // Ownership verification
    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    if (!dbState.musicUrl) {
      console.log("⚠️ Missing musicUrl in DB:", dbState);
      return res.status(400).json({ error: "Music URL missing" });
    }

    const newState = roomManager.playMusic(
      roomId,
      { name: dbState.musicFile.name },
      userId,
      dbState.trackOwnerId || userId,
      dbState.currentTrackId,
      dbState.duration || 0
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: true,
        startedAt: newState.startedAt || new Date(),
        pausedAt: 0,
        playedBy: userId,
      },
    );

    await broadcastMusicState(roomId, io);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ playMusic:", error);
    res.status(500).json({ error: error.message });
  }
};

/* ============================
   PAUSE MUSIC (DJ ONLY)
============================ */
exports.pauseMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { pausedAt, userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState || !dbState.isPlaying) {
      return res.status(400).json({ error: "Music not playing" });
    }

    // Ownership verification
    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const safePausedAt = Math.max(0, Math.floor(pausedAt));

    roomManager.pauseMusic(roomId, safePausedAt);

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: false,
        pausedAt: safePausedAt,
      },
    );

    await broadcastMusicState(roomId, io);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   RESUME MUSIC (DJ ONLY)
============================ */
exports.resumeMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState) return res.status(400).json({ error: "No music state found" });

    // Ownership verification
    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const newState = roomManager.resumeMusic(roomId);

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: true,
        startedAt: newState.startedAt || new Date(),
        pausedAt: 0,
      },
    );

    await broadcastMusicState(roomId, io);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   STOP MUSIC (RELEASE LOCK)
============================ */
exports.stopMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState) return res.json({ success: true });

    // Ownership verification
    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

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
        currentTrackId: null,
        trackOwnerId: null,
        duration: 0,
      },
    );

    await broadcastMusicState(roomId, io);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ stopMusic:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   SELECT TRACK FROM PLAYLIST
============================ */
exports.selectTrack = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId, musicId } = req.params;
    const { userId } = req.body;

    if (!userId || !musicId) return res.status(400).json({ error: "userId and musicId required" });

    // If there is an active track playing, make sure current owner controls it
    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const track = await RoomMusic.findById(musicId);
    if (!track) return res.status(404).json({ error: "Track not found" });

    roomManager.initRoom(roomId);
    
    // Play the track instantly
    const newState = roomManager.playMusic(
      roomId,
      { name: track.originalName },
      userId,
      track.uploadedBy,
      track._id,
      track.duration || 0
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        currentTrackId: track._id,
        trackOwnerId: track.uploadedBy,
        musicFile: { name: track.originalName, fileSize: track.fileSize || 0 },
        musicUrl: track.musicUrl,
        isPlaying: true,
        startedAt: newState.startedAt || new Date(),
        pausedAt: 0,
        playedBy: userId,
        duration: track.duration || 0,
      },
      { upsert: true }
    );

    await broadcastMusicState(roomId, io);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ selectTrack error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   NEXT TRACK
============================ */
exports.nextTrack = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState || !dbState.currentTrackId) {
      return res.status(400).json({ error: "No track currently playing" });
    }

    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const playlist = await RoomMusic.find({ roomId }).sort({ createdAt: 1 });
    if (!playlist.length) return res.status(400).json({ error: "Playlist empty" });

    const currentIndex = playlist.findIndex((m) => m._id.toString() === dbState.currentTrackId.toString());
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      nextIndex = playlist.length - 1; // Stay on last track
    }

    const track = playlist[nextIndex];
    roomManager.initRoom(roomId);
    const newState = roomManager.playMusic(
      roomId,
      { name: track.originalName },
      userId,
      track.uploadedBy,
      track._id,
      track.duration || 0
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        currentTrackId: track._id,
        trackOwnerId: track.uploadedBy,
        musicFile: { name: track.originalName, fileSize: track.fileSize || 0 },
        musicUrl: track.musicUrl,
        isPlaying: true,
        startedAt: newState.startedAt || new Date(),
        pausedAt: 0,
        playedBy: userId,
        duration: track.duration || 0,
      }
    );

    await broadcastMusicState(roomId, io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   PREVIOUS TRACK
============================ */
exports.previousTrack = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState || !dbState.currentTrackId) {
      return res.status(400).json({ error: "No track currently playing" });
    }

    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const playlist = await RoomMusic.find({ roomId }).sort({ createdAt: 1 });
    if (!playlist.length) return res.status(400).json({ error: "Playlist empty" });

    const currentIndex = playlist.findIndex((m) => m._id.toString() === dbState.currentTrackId.toString());
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = 0; // Stay on first track
    }

    const track = playlist[prevIndex];
    roomManager.initRoom(roomId);
    const newState = roomManager.playMusic(
      roomId,
      { name: track.originalName },
      userId,
      track.uploadedBy,
      track._id,
      track.duration || 0
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        currentTrackId: track._id,
        trackOwnerId: track.uploadedBy,
        musicFile: { name: track.originalName, fileSize: track.fileSize || 0 },
        musicUrl: track.musicUrl,
        isPlaying: true,
        startedAt: newState.startedAt || new Date(),
        pausedAt: 0,
        playedBy: userId,
        duration: track.duration || 0,
      }
    );

    await broadcastMusicState(roomId, io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   SEEK TO POSITION
============================ */
exports.seekMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { position, userId } = req.body;

    if (!userId || position === undefined) return res.status(400).json({ error: "userId and position required" });

    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    roomManager.seekTo(roomId, position);

    const state = roomManager.getState(roomId);
    await MusicState.findOneAndUpdate(
      { roomId },
      {
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        pausedAt: state.pausedAt,
      }
    );

    await broadcastMusicState(roomId, io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   FORWARD TRACK (+10s)
============================ */
exports.forwardMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const currentPos = roomManager.getCurrentPosition(roomId);
    const newPos = currentPos + 10;

    roomManager.seekTo(roomId, newPos);

    const state = roomManager.getState(roomId);
    await MusicState.findOneAndUpdate(
      { roomId },
      {
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        pausedAt: state.pausedAt,
      }
    );

    await broadcastMusicState(roomId, io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   REWIND TRACK (-10s)
============================ */
exports.rewindMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const isOwner = await validateOwnership(roomId, userId);
    if (!isOwner) {
      return res.status(403).json({
        error: "Only the uploader of this track can control playback.",
        message: "Only the uploader of this track can control playback."
      });
    }

    const currentPos = roomManager.getCurrentPosition(roomId);
    const newPos = Math.max(0, currentPos - 10);

    roomManager.seekTo(roomId, newPos);

    const state = roomManager.getState(roomId);
    await MusicState.findOneAndUpdate(
      { roomId },
      {
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        pausedAt: state.pausedAt,
      }
    );

    await broadcastMusicState(roomId, io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   GET MUSIC STATE (GET)
============================ */
exports.getMusicState = async (req, res) => {
  try {
    const { roomId } = req.params;

    roomManager.initRoom(roomId);

    const state = roomManager.getState(roomId);
    const dbState = await MusicState.findOne({ roomId });

    res.json({
      roomId,
      currentTrackId: dbState?.currentTrackId ? dbState.currentTrackId.toString() : null,
      currentPosition: roomManager.getCurrentPosition(roomId),
      isPlaying: state.isPlaying,
      startedAt: state.startedAt,
      pausedAt: state.pausedAt,
      trackOwnerId: dbState?.trackOwnerId ? dbState.trackOwnerId.toString() : null,
      playedBy: state.playedBy,
      musicFile: state.musicFile,
      musicUrl: dbState?.musicUrl || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   GET PLAYLIST FOR ROOM (ALL USERS)
============================ */
exports.getRoomMusicList = async (req, res) => {
  try {
    const { roomId } = req.params;

    const list = await RoomMusic.find({ roomId }).sort({ createdAt: 1 });

    return res.json({
      success: true,
      data: list,
    });
  } catch (error) {
    console.error("❌ getRoomMusicList:", error);
    return res.status(500).json({ error: error.message });
  }
};

/* ============================
   DELETE TRACK
============================ */
exports.deleteRoomMusicList = async (req, res) => {
  try {
    const { roomId, musicId } = req.params;
    const userId = req.headers["userid"] || req.body.userId;
    const io = req.app.get("io");

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    if (!mongoose.Types.ObjectId.isValid(musicId)) {
      return res.status(400).json({ error: "Invalid musicId" });
    }

    const music = await RoomMusic.findOne({ _id: musicId, roomId });
    if (!music) {
      return res.status(404).json({ error: "Music not found" });
    }

    // Check uploader permission
    if (music.uploadedBy.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not allowed" });
    }

    // Cloudinary destroy
    if (music.cloudinaryPublicId) {
      try {
        await cloudinary.uploader.destroy(music.cloudinaryPublicId, {
          resource_type: "video",
        });
      } catch (err) {
        console.error("⚠️ Cloudinary delete failed:", err.message);
      }
    }

    await RoomMusic.deleteOne({ _id: musicId });

    // Stop music if deleted song is current
    const state = roomManager.getState(roomId);
    const dbState = await MusicState.findOne({ roomId });
    if (dbState?.currentTrackId?.toString() === musicId) {
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
          currentTrackId: null,
          trackOwnerId: null,
          duration: 0,
        },
      );
    }

    await broadcastMusicState(roomId, io);

    return res.json({
      success: true,
      message: "Music deleted successfully",
    });
  } catch (error) {
    console.error("❌ deleteRoomMusicList ERROR:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/* ============================
   CLEAR QUEUE (HOST/ADMIN ONLY)
 ============================ */
exports.clearQueue = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const userId = req.headers["userid"] || (req.body && req.body.userId);

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // 1. Verify if user is Host or Admin (only they can clear the queue)
    const room = await Room.findOne({ roomId }).select("host participants").lean();
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const isHost = room.host && room.host.toString() === userId.toString();
    const isAdmin = room.participants && room.participants.some(p => p.user && p.user.toString() === userId.toString() && p.role === "admin");
    if (!isHost && !isAdmin) {
      return res.status(403).json({ error: "Only the Host or Admins can clear the queue." });
    }

    // 2. Fetch all music in room to delete from Cloudinary
    const musicList = await RoomMusic.find({ roomId });

    for (const music of musicList) {
      if (music.cloudinaryPublicId) {
        try {
          await cloudinary.uploader.destroy(music.cloudinaryPublicId, {
            resource_type: "video",
          });
        } catch (err) {
          console.error("⚠️ Cloudinary delete failed during clearQueue:", err.message);
        }
      }
    }

    // 3. Delete all room music documents
    await RoomMusic.deleteMany({ roomId });

    // 4. Stop current playback and reset MusicState
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
        currentTrackId: null,
        trackOwnerId: null,
        duration: 0,
      },
      { upsert: true }
    );

    // 5. Broadcast to room
    await broadcastMusicState(roomId, io);

    res.json({ success: true, message: "Queue cleared successfully" });
  } catch (err) {
    console.error("❌ clearQueue error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   STARTUP MIGRATION & RESTORE
============================ */
exports.migrateMusicData = async () => {
  try {
    const RoomMusic = require("../models/musicRoom");
    const MusicState = require("../models/musicState");
    const User = require("../models/users");

    // 1. Update RoomMusic records that lack uploaderUsername or duration
    const tracksWithoutUsername = await RoomMusic.find({
      $or: [
        { uploaderUsername: { $exists: false } },
        { uploaderUsername: "" },
        { duration: { $exists: false } }
      ]
    });

    for (const track of tracksWithoutUsername) {
      let uploaderUsername = track.uploaderUsername;
      if (!uploaderUsername && track.uploadedBy) {
        const user = await User.findById(track.uploadedBy).select("username").lean();
        uploaderUsername = user?.username || "User";
      }
      track.uploaderUsername = uploaderUsername || "User";
      if (track.duration === undefined || track.duration === null) {
        track.duration = 0;
      }
      await track.save();
    }

    // 2. Update MusicState records that lack trackOwnerId or currentTrackId or duration
    const states = await MusicState.find({
      $or: [
        { trackOwnerId: { $exists: false } },
        { currentTrackId: { $exists: false } },
        { duration: { $exists: false } }
      ]
    });

    for (const state of states) {
      let modified = false;
      if (!state.trackOwnerId && state.playedBy) {
        state.trackOwnerId = state.playedBy;
        modified = true;
      }
      if (state.duration === undefined || state.duration === null) {
        state.duration = 0;
        modified = true;
      }
      if (!state.currentTrackId && state.musicUrl) {
        const track = await RoomMusic.findOne({ roomId: state.roomId, musicUrl: state.musicUrl });
        if (track) {
          state.currentTrackId = track._id;
          state.trackOwnerId = track.uploadedBy;
          state.duration = track.duration || 0;
          modified = true;
        }
      }
      if (modified) {
        await state.save();
      }
    }
    console.log("✅ Music data migration complete.");
  } catch (err) {
    console.error("❌ Error migrating music data:", err);
  }
};

exports.restoreAllMusicStates = async () => {
  try {
    const MusicState = require("../models/musicState");
    const states = await MusicState.find({});
    for (const state of states) {
      if (state.roomId) {
        roomManager.initRoom(state.roomId);
        if (state.isPlaying && state.musicUrl) {
          const elapsed = state.startedAt ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000) : 0;
          if (state.duration && elapsed >= state.duration) {
            roomManager.stopMusic(state.roomId);
            await MusicState.updateOne(
              { roomId: state.roomId },
              { isPlaying: false, pausedAt: state.duration, startedAt: null }
            );
          } else {
            const playState = {
              currentTrackId: state.currentTrackId ? state.currentTrackId.toString() : null,
              musicFile: state.musicFile || { name: "Music" },
              isPlaying: true,
              startedAt: state.startedAt ? new Date(state.startedAt).getTime() : Date.now(),
              pausedAt: 0,
              playedBy: state.playedBy ? state.playedBy.toString() : null,
              trackOwnerId: state.trackOwnerId ? state.trackOwnerId.toString() : null,
              duration: state.duration || 0,
            };
            roomManager.roomMusicStates.set(state.roomId, playState);
          }
        } else if (state.musicUrl) {
          const pauseState = {
            currentTrackId: state.currentTrackId ? state.currentTrackId.toString() : null,
            musicFile: state.musicFile || { name: "Music" },
            isPlaying: false,
            startedAt: null,
            pausedAt: state.pausedAt || 0,
            playedBy: state.playedBy ? state.playedBy.toString() : null,
            trackOwnerId: state.trackOwnerId ? state.trackOwnerId.toString() : null,
            duration: state.duration || 0,
          };
          roomManager.roomMusicStates.set(state.roomId, pauseState);
        }
      }
    }
    console.log(`✅ Restored music states for ${states.length} rooms.`);
  } catch (err) {
    console.error("❌ Error restoring music states:", err);
  }
};
