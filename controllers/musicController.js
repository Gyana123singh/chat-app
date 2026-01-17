const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");
const path = require("path");
const mongoose = require("mongoose");
const RoomMusic = require("../models/musicRoom");
const convertToMp3 = require("../utils/convertAudio");

exports.uploadMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const userId = req.body.userId || req.headers["userid"];

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    roomManager.initRoom(roomId);

    let filePath = req.file.path;
    let filename = req.file.filename;
    let originalname = req.file.originalname;
    const size = req.file.size;

    // ✅ OPUS → MP3 CONVERSION
    if (
      req.file.mimetype.includes("opus") ||
      originalname.toLowerCase().endsWith(".opus")
    ) {
      const mp3Path = await convertToMp3(filePath);

      await fs.remove(filePath); // delete opus

      filePath = mp3Path;
      filename = path.basename(mp3Path);
      originalname = originalname.replace(/\.opus$/i, ".mp3");
    }

    const musicUrl = `${req.protocol}://${req.get(
      "host"
    )}/stream/${roomId}/${filename}`;

    // ✅ DO NOT TOUCH roomManager state here
    await MusicState.findOneAndUpdate(
      { roomId },
      {
        roomId,
        musicFile: { name: originalname, fileSize: size },
        musicUrl,
        localFilePath: filePath,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: userId,
      },
      { upsert: true }
    );

    await RoomMusic.create({
      roomId,
      fileName: filename,
      originalName: originalname,
      fileSize: size,
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

exports.playMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    roomManager.initRoom(roomId);

    const dbState = await MusicState.findOne({ roomId });

    if (!dbState || !dbState.musicUrl) {
      return res.status(400).json({ error: "No music uploaded" });
    }

    // ▶️ START PLAYBACK (SERVER SOURCE OF TRUTH)
    const newState = roomManager.playMusic(
      roomId,
      {
        name: dbState.musicFile.name,
        filename: path.basename(dbState.localFilePath),
      },
      userId
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: true,
        startedAt: newState.startedAt,
        pausedAt: 0,
        playedBy: userId,
      }
    );

    // ✅ AUTHORITATIVE MUSIC STATE
    const payload = {
      musicFile: newState.musicFile,
      musicUrl: dbState.musicUrl,
      isPlaying: true,
      startedAt: newState.startedAt,
      currentPosition: 0,
      playedBy: userId,
    };

    // 🔥 VERY IMPORTANT
    io.to(`room:${roomId}`).emit("music:play", payload);
    io.to(`room:${roomId}`).emit("room:musicState", payload);

    return res.json({
      success: true,
      message: "Music started",
    });
  } catch (error) {
    console.error("❌ playMusic error:", error);
    return res.status(500).json({ error: error.message });
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
    const io = req.app.get("io"); // ✅ SAFE socket access

    console.log("🎵 DELETE REQUEST:", { roomId, musicId });

    if (!mongoose.Types.ObjectId.isValid(musicId)) {
      return res.status(400).json({ error: "Invalid musicId" });
    }

    const music = await RoomMusic.findOne({ _id: musicId, roomId });

    if (!music) {
      return res.status(404).json({ error: "Music not found" });
    }

    /* ============================
       DELETE FILE FROM STORAGE
    ============================ */
    const filePath = path.join(
      process.cwd(), // 🔥 ALWAYS ROOT
      "uploads",
      roomId,
      music.fileName
    );

    console.log("🗑️ Deleting file:", filePath);

    try {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        console.log("✅ File deleted");
      } else {
        console.log("⚠️ File not found on disk");
      }
    } catch (fileErr) {
      console.error("❌ FILE DELETE ERROR:", fileErr);
    }

    /* ============================
       DELETE FROM DB
    ============================ */
    await RoomMusic.deleteOne({ _id: musicId });

    /* ============================
       STOP IF CURRENTLY PLAYING
    ============================ */
    const state = roomManager.getState(roomId);

    if (
      state?.musicFile?.filename === music.fileName ||
      state?.musicFile?.name === music.originalName
    ) {
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
        }
      );

      io?.to(`room:${roomId}`).emit("music:stopped", {
        reason: "deleted",
      });
    }

    /* ============================
       NOTIFY ROOM
    ============================ */
    io?.to(`room:${roomId}`).emit("music:list:deleted", {
      musicId,
    });

    return res.json({
      success: true,
      message: "Music deleted successfully",
    });
  } catch (error) {
    console.error("❌ deleteRoomMusicList FATAL ERROR:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.pauseMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { pausedAt } = req.body;

    const state = roomManager.getState(roomId);
    if (!state.isPlaying)
      return res.status(400).json({ error: "Music is not playing" });

    roomManager.pauseMusic(roomId, pausedAt);

    await MusicState.findOneAndUpdate(
      { roomId },
      { isPlaying: false, pausedAt }
    );

    io.to(`room:${roomId}`).emit("music:paused", { pausedAt });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ pauseMusic:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.resumeMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    const state = roomManager.getState(roomId);
    if (state.isPlaying)
      return res.status(400).json({ error: "Music already playing" });

    const newState = roomManager.resumeMusic(roomId);

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: true,
        startedAt: newState.startedAt, // ✅ FIX
        pausedAt: 0,
      }
    );

    io.to(`room:${roomId}`).emit("music:resumed", {
      startedAt: newState.startedAt, // ✅ FIX
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ resumeMusic:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.stopMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    roomManager.stopMusic(roomId);

    const state = await MusicState.findOne({ roomId });
    if (state?.localFilePath) await fs.remove(state.localFilePath);

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
      }
    );

    io.to(`room:${roomId}`).emit("music:stopped");

    res.json({ success: true, message: "Music stopped." });
  } catch (error) {
    console.error("❌ stopMusic:", error);
    res.status(500).json({ error: error.message });
  }
};

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
      playedBy: state.playedBy,
    });
  } catch (error) {
    console.error("❌ getMusicState:", error);
    res.status(500).json({ error: error.message });
  }
};
