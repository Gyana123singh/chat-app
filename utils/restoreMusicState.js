const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");

async function restoreMusicState(roomId) {
  const db = await MusicState.findOne({ roomId });

  if (!db || !db.musicUrl) return;

  roomManager.roomMusicStates.set(roomId, {
    musicFile: db.musicFile,
    isPlaying: db.isPlaying,
    startedAt: db.startedAt,
    pausedAt: db.pausedAt || 0,
    playedBy: db.playedBy?.toString() || null,
  });
}

module.exports = restoreMusicState;
