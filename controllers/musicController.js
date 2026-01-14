const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");
const path = require("path");

exports.uploadAndPlayMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const userId = req.body.userId;

    // ✅ Get uploaded file info
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { originalname, filename, size } = req.file;
    const musicUrl = `/stream/${roomId}/${filename}`; // Server stream URL

    // ✅ Update RoomManager
    const newState = roomManager.playMusic(roomId, {
      name: originalname,
      filename,
      size,
      duration: req.body.duration || 0,
    });

    // ✅ Save to database
    await MusicState.findOneAndUpdate(
      { roomId },
      {
        musicFile: { name: originalname, filename, size },
        musicUrl,
        localFilePath: req.file.path,
        isPlaying: true,
        startedAt: new Date(newState.startedAt),
        hostId: userId,
      },
      { upsert: true }
    );

    // ✅ BROADCAST TO ALL USERS
    io.to(`room:${roomId}`).emit("music:playing", {
      musicFile: { name: originalname, filename, size },
      musicUrl: `http://${req.get("host")}${musicUrl}`, // Full URL
      startedAt: Date.now(),
      currentPosition: 0,
    });

    res.json({
      success: true,
      state: newState,
      musicUrl: `http://${req.get("host")}${musicUrl}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.pauseMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { pausedAt } = req.body;

    const newState = roomManager.pauseMusic(roomId, pausedAt);

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        isPlaying: false,
        pausedAt: Date.now(),
      }
    );

    io.to(`room:${roomId}`).emit("music:paused", {
      pausedAt,
      timestamp: Date.now(),
    });

    res.json({ success: true, state: newState });
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
        startedAt: new Date(newState.startedAt),
        pausedAt: null,
      }
    );

    io.to(`room:${roomId}`).emit("music:resumed", {
      resumeFrom: newState.pausedAt || 0,
      startedAt: Date.now(),
    });

    res.json({ success: true, state: newState });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.stopMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    roomManager.stopMusic(roomId);

    const musicState = await MusicState.findOne({ roomId });
    if (musicState?.localFilePath) {
      await fs.remove(musicState.localFilePath); // Cleanup
    }

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        musicFile: null,
        musicUrl: null,
        isPlaying: false,
      }
    );

    io.to(`room:${roomId}`).emit("music:stopped", { timestamp: Date.now() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMusicState = async (req, res) => {
  try {
    const { roomId } = req.params;
    const state = roomManager.getState(roomId);
    const dbState = await MusicState.findOne({ roomId });

    res.json({
      musicFile: state.musicFile,
      musicUrl: dbState?.musicUrl,
      isPlaying: state.isPlaying,
      currentPosition: roomManager.getCurrentPosition(roomId),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
