const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");

exports.uploadAndPlayMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    roomManager.initRoom(roomId);
    const state = roomManager.getState(roomId);

    if (state.locked || state.isPlaying) {
      return res.status(409).json({
        error:
          "Music already playing. Please wait until it finishes or is stopped.",
      });
    }

    const { originalname, filename, size } = req.file;
    const musicUrl = `/stream/${roomId}/${filename}`;

    const newState = roomManager.playMusic(
      roomId,
      { name: originalname, filename, size },
      userId
    );

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        roomId,
        musicFile: { name: originalname, fileSize: size },
        musicUrl,
        localFilePath: req.file.path,
        isPlaying: true,
        locked: true,
        startedAt: new Date(newState.startedAt),
        pausedAt: 0,
        playedBy: userId,
      },
      { upsert: true, new: true }
    );

    io.to(`room:${roomId}`).emit("music:ready", {
      musicFile: { name: originalname },
      musicUrl: `http://${req.get("host")}${musicUrl}`,
      startedAt: newState.startedAt,
      currentPosition: 0,
      playedBy: userId,
    });

    return res.json({
      success: true,
      message: "Music started successfully",
      musicUrl: `http://${req.get("host")}${musicUrl}`,
    });
  } catch (error) {
    console.error("❌ uploadAndPlayMusic:", error);
    res.status(500).json({ error: error.message });
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
        startedAt: new Date(newState.startedAt),
        pausedAt: 0,
      }
    );

    io.to(`room:${roomId}`).emit("music:resumed", {
      startedAt: newState.startedAt,
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
        locked: false,
        pausedAt: 0,
        startedAt: null,
        localFilePath: null,
        playedBy: null,
      }
    );

    io.to(`room:${roomId}`).emit("music:stopped");

    res.json({ success: true, message: "Music stopped. Room unlocked." });
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
      locked: state.locked,
      currentPosition: roomManager.getCurrentPosition(roomId),
      playedBy: dbState?.playedBy || null,
    });
  } catch (error) {
    console.error("❌ getMusicState:", error);
    res.status(500).json({ error: error.message });
  }
};
