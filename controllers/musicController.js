const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");
const path = require("path");
const mongoose = require("mongoose");
const RoomMusic = require("../models/musicRoom");

exports.uploadMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const userId = req.body.userId || req.headers["userid"];

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    roomManager.initRoom(roomId);

    const { originalname, filename, size } = req.file;

    const musicUrl = `${req.protocol}://${req.get(
      "host"
    )}/stream/${roomId}/${filename}`;

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        roomId,
        musicFile: { name: originalname, fileSize: size },
        musicUrl,
        localFilePath: req.file.path,
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

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ uploadMusic:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.playMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    roomManager.initRoom(roomId);

    const dbState = await MusicState.findOne({ roomId });
    if (!dbState || !dbState.musicUrl) {
      return res.status(400).json({ error: "No music uploaded" });
    }

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

    const payload = {
      musicFile: newState.musicFile,
      musicUrl: dbState.musicUrl,
      isPlaying: true,
      startedAt: newState.startedAt,
      playedBy: userId,
    };

    // 🔥 THIS TRIGGERS FLUTTER AUDIO PLAYER
    io.to(`room:${roomId}`).emit("music:play", payload);
    io.to(`room:${roomId}`).emit("room:musicState", payload);

    return res.json({
      success: true,
      musicUrl: dbState.musicUrl,
      startedAt: newState.startedAt,
    });
  } catch (error) {
    console.error("❌ playMusic:", error);
    return res.status(500).json({ error: error.message });
  }
};

exports.getRoomMusicList = async (req, res) => {
  try {
    const { roomId } = req.params;

    const list = await RoomMusic.find({ roomId }).sort({ createdAt: -1 });

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
    const io = req.app.get("io");

    if (!mongoose.Types.ObjectId.isValid(musicId)) {
      return res.status(400).json({ error: "Invalid musicId" });
    }

    const music = await RoomMusic.findOne({ _id: musicId, roomId });
    if (!music) return res.status(404).json({ error: "Music not found" });

    const filePath = path.resolve(
      process.cwd(),
      "uploads",
      roomId,
      music.fileName
    );

    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }

    await RoomMusic.deleteOne({ _id: musicId });

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

      io.to(`room:${roomId}`).emit("music:stopped", {
        reason: "deleted",
      });
    }

    io.to(`room:${roomId}`).emit("music:list:deleted", { musicId });

    return res.json({
      success: true,
      message: "Music deleted successfully",
    });
  } catch (error) {
    console.error("❌ deleteRoomMusicList:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.pauseMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { pausedAt } = req.body;

    roomManager.pauseMusic(roomId, pausedAt);

    await MusicState.findOneAndUpdate(
      { roomId },
      { isPlaying: false, pausedAt }
    );

    io.to(`room:${roomId}`).emit("music:paused", { pausedAt });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resumeMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    const newState = roomManager.resumeMusic(roomId);

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: true,
        startedAt: newState.startedAt,
        pausedAt: 0,
      }
    );

    io.to(`room:${roomId}`).emit("music:resumed", {
      startedAt: newState.startedAt,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.stopMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;

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

    io.to(`room:${roomId}`).emit("music:stopped");

    res.json({ success: true });
  } catch (error) {
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
      startedAt: state.startedAt,
      playedBy: state.playedBy,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
