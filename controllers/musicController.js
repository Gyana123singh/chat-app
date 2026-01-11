const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");

exports.playMusic = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { musicFile, userId } = req.body;

    const newState = roomManager.playMusic(roomId, musicFile);

    await MusicState.findOneAndUpdate(
      { roomId },
      {
        musicFile,
        isPlaying: true,
        startedAt: new Date(newState.startedAt),
        hostId: userId,
      },
      { upsert: true }
    );

    res.json({ success: true, state: newState });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.pauseMusic = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { pausedAt } = req.body;

    const newState = roomManager.pauseMusic(roomId, pausedAt);

    await MusicState.findOneAndUpdate(
      { roomId },
      { isPlaying: false, pausedAt }
    );

    res.json({ success: true, state: newState });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resumeMusic = async (req, res) => {
  try {
    const { roomId } = req.params;

    const newState = roomManager.resumeMusic(roomId);

    await MusicState.findOneAndUpdate(
      { roomId },
      { isPlaying: true, startedAt: new Date(newState.startedAt) }
    );

    res.json({ success: true, state: newState });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.stopMusic = async (req, res) => {
  try {
    const { roomId } = req.params;

    roomManager.stopMusic(roomId);

    await MusicState.findOneAndUpdate(
      { roomId },
      { musicFile: null, isPlaying: false }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMusicState = async (req, res) => {
  try {
    const { roomId } = req.params;

    const state = roomManager.getState(roomId);
    const currentPosition = roomManager.getCurrentPosition(roomId);

    res.json({
      musicFile: state.musicFile,
      isPlaying: state.isPlaying,
      currentPosition: currentPosition,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
