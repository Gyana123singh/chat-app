const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");
const fs = require("fs-extra");
const mongoose = require("mongoose");
const RoomMusic = require("../models/musicRoom");
exports.uploadAndPlayMusic = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const userId = req.body.userId || req.query.userId || req.headers["userid"];

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ error: "Invalid userId" });

    roomManager.initRoom(roomId);

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
        startedAt: new Date(newState.startedAt),
        pausedAt: 0,
        playedBy: new mongoose.Types.ObjectId(userId),
      },
      { upsert: true, new: true }
    );

    // 🔥 THIS CREATES THE LIST ITEM
    await RoomMusic.create({
      roomId,
      fileName: filename,
      originalName: originalname,
      fileSize: size,
      musicUrl: `${req.protocol}://${req.get("host")}${musicUrl}`,
      uploadedBy: new mongoose.Types.ObjectId(userId),
    });

    io.to(`room:${roomId}`).emit("music:ready", {
      musicFile: { name: originalname },
      musicUrl: `${req.protocol}://${req.get("host")}${musicUrl}`,
      startedAt: newState.startedAt,
      currentPosition: 0,
      playedBy: userId,
    });

    return res.json({
      success: true,
      message: "Music uploaded & ready",
      filename,
      musicUrl: `${req.protocol}://${req.get("host")}${musicUrl}`,
    });
  } catch (error) {
    console.error("❌ uploadAndPlayMusic:", error);
    res.status(500).json({ error: error.message });
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
