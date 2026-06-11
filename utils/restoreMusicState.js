const MusicState = require("../models/musicState");
const roomManager = require("../utils/musicRoomManager");

async function restoreMusicState(roomId) {
  const db = await MusicState.findOne({ roomId });

  if (!db || !db.musicUrl) return;

  roomManager.initRoom(roomId);

  if (db.isPlaying && db.startedAt) {
    roomManager.roomMusicStates.set(roomId, {
      currentTrackId: db.currentTrackId ? db.currentTrackId.toString() : null,
      musicFile: db.musicFile,
      isPlaying: true,
      startedAt: new Date(db.startedAt).getTime(), // ✅ FIX
      pausedAt: 0,
      playedBy: db.playedBy?.toString() || null,
      trackOwnerId: db.trackOwnerId ? db.trackOwnerId.toString() : null,
      duration: db.duration || 0,
    });
  } else {
    roomManager.roomMusicStates.set(roomId, {
      currentTrackId: db.currentTrackId ? db.currentTrackId.toString() : null,
      musicFile: db.musicFile,
      isPlaying: false,
      startedAt: null,
      pausedAt: db.pausedAt || 0,
      playedBy: db.playedBy?.toString() || null,
      trackOwnerId: db.trackOwnerId ? db.trackOwnerId.toString() : null,
      duration: db.duration || 0,
    });
  }
}

module.exports = restoreMusicState;
