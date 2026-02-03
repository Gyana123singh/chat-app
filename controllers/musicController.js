const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");
const path = require("path");
const mongoose = require("mongoose");
const RoomMusic = require("../models/musicRoom");
const convertToMp3 = require("../utils/convertAudio");
const cloudinary = require("../config/cloudinary");

/* ============================
   UPLOAD MUSIC (DJ LOCK)
============================ */
exports.uploadMusic = async (req, res) => {
  const io = req.app.get("io");
  try {
    const { roomId } = req.params;
    const userId = req.body.userId || req.headers["userid"];

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    roomManager.initRoom(roomId);

    // 🔒 BLOCK IF SESSION ACTIVE (PLAYING OR PAUSED)
    const currentState = await MusicState.findOne({ roomId });
    if (currentState?.playedBy) {
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

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        roomId,
        musicFile: { name: originalname, fileSize: size },
        musicUrl, // Cloudinary URL
        localFilePath: null, // IMPORTANT
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: userId,
      },
      { upsert: true },
    );

    await RoomMusic.create({
      roomId,
      fileName: filename,
      originalName: originalname,
      fileSize: size,
      cloudinaryPublicId: public_id, // ✅ ADD THIS
      musicUrl,
      uploadedBy: userId,
    });

    io.to(`room:${roomId}`).emit("music:uploaded", {
      musicFile: { name: originalname, filename, size },
      musicUrl,
    });

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

    if (!dbState || !dbState.musicUrl)
      return res.status(400).json({ error: "No music uploaded" });

    // 🛡 SAFETY
    if (!dbState.playedBy) {
      return res.status(400).json({ error: "No active DJ" });
    }

    if (dbState.playedBy.toString() !== userId.toString()) {
      return res.status(403).json({
        error: "Only current DJ can play this music",
      });
    }

    const newState = roomManager.playMusic(
      roomId,
      {
        name: dbState.musicFile.name,
      },
      userId,
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: true,
        startedAt: newState.startedAt,
        pausedAt: 0,
      },
    );

    const payload = {
      musicFile: newState.musicFile,
      musicUrl: dbState.musicUrl,
      isPlaying: true,
      startedAt: newState.startedAt,
      currentPosition: 0,
      playedBy: dbState.playedBy,
    };

    io.to(`room:${roomId}`).emit("music:play", payload);
    io.to(`room:${roomId}`).emit("room:musicState", payload);

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

    const dbState = await MusicState.findOne({ roomId });

    if (!dbState || !dbState.isPlaying)
      return res.status(400).json({ error: "Music not playing" });

    if (!dbState.playedBy)
      return res.status(400).json({ error: "No active DJ" });

    if (dbState.playedBy.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Only DJ can pause" });
    }

    roomManager.pauseMusic(roomId, pausedAt);

    await MusicState.findOneAndUpdate(
      { roomId },
      { isPlaying: false, pausedAt },
    );

    io.to(`room:${roomId}`).emit("music:paused", { pausedAt });

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

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState) return res.status(400).json({ error: "No music" });

    if (!dbState.playedBy)
      return res.status(400).json({ error: "No active DJ" });

    if (dbState.playedBy.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Only DJ can resume" });
    }

    const newState = roomManager.resumeMusic(roomId);

    await MusicState.findOneAndUpdate(
      { roomId },
      { isPlaying: true, startedAt: newState.startedAt, pausedAt: 0 },
    );

    io.to(`room:${roomId}`).emit("music:resumed", {
      startedAt: newState.startedAt,
    });

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

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState) return res.json({ success: true });

    if (!dbState.playedBy) return res.json({ success: true });

    if (dbState.playedBy.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Only DJ can stop music" });
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
        playedBy: null, // 🔓 UNLOCK
      },
    );

    io.to(`room:${roomId}`).emit("music:stopped");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================
   GET MUSIC STATE
============================ */
exports.getMusicState = async (req, res) => {
  try {
    const { roomId } = req.params;

    roomManager.initRoom(roomId);

    const state = roomManager.getState(roomId);
    const dbState = await MusicState.findOne({ roomId });

    res.json({
      musicFile: state.musicFile,
      musicUrl: dbState?.musicUrl || null,
      isPlaying: state.isPlaying,
      currentPosition: roomManager.getCurrentPosition(roomId),
      playedBy: dbState?.playedBy || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getRoomMusicList = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.headers["userid"] || req.query.userId;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const list = await RoomMusic.find({
      roomId,
      uploadedBy: userId, // 🔥 PRIVATE PER USER
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: list,
    });
  } catch (error) {
    console.error("❌ getRoomMusicList:", error);
    return res.status(500).json({ error: error.message });
  }
};

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

    // 1️⃣ FIND MUSIC
    const music = await RoomMusic.findOne({ _id: musicId, roomId });

    if (!music) {
      return res.status(404).json({ error: "Music not found" });
    }

    // 2️⃣ 🔐 PERMISSION CHECK (UPLOADER ONLY)
    if (music.uploadedBy.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not allowed" });
    }

    // 3️⃣ ☁️ DELETE FROM CLOUDINARY (SAFE)
    if (music.cloudinaryPublicId) {
      try {
        await cloudinary.uploader.destroy(music.cloudinaryPublicId, {
          resource_type: "video",
        });
      } catch (err) {
        console.error("⚠️ Cloudinary delete failed:", err.message);
        // ❗ Do NOT block delete if Cloudinary fails
      }
    }

    // 4️⃣ DELETE FROM DB
    await RoomMusic.deleteOne({ _id: musicId });

    // 5️⃣ STOP MUSIC IF THIS TRACK IS CURRENTLY PLAYING
    const state = roomManager.getState(roomId);

    if (state?.musicFile?.name === music.originalName) {
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

      io.to(`room:${roomId}`).emit("music:stopped", {
        reason: "deleted",
      });
    }

    // 6️⃣ NOTIFY ROOM
    io.to(`room:${roomId}`).emit("music:list:deleted", {
      musicId,
    });

    return res.json({
      success: true,
      message: "Music deleted successfully",
    });
  } catch (error) {
    console.error("❌ deleteRoomMusicList ERROR:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
