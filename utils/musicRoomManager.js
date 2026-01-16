class RoomManager {
  constructor() {
    this.roomMusicStates = new Map();
  }

  // 🔥 Always ensure fresh state (fixes rejoin + reupload bug)
  initRoom(roomId) {
    this.roomMusicStates.set(roomId, {
      musicFile: null,
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
      playedBy: null, // ALWAYS STRING
    });
  }

  getState(roomId) {
    return (
      this.roomMusicStates.get(roomId) || {
        musicFile: null,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: null,
      }
    );
  }

  playMusic(roomId, musicFile, playedByUserId) {
    const state = {
      musicFile,
      isPlaying: true,
      startedAt: Date.now(),
      pausedAt: 0,
      playedBy: playedByUserId.toString(),
    };

    this.roomMusicStates.set(roomId, state);
    return state;
  }

  pauseMusic(roomId, position) {
    const state = this.getState(roomId);

    state.isPlaying = false;
    state.pausedAt = position;

    this.roomMusicStates.set(roomId, state);
    return state;
  }

  resumeMusic(roomId) {
    const state = this.getState(roomId);

    state.isPlaying = true;
    state.startedAt = Date.now() - state.pausedAt;
    state.pausedAt = 0;

    this.roomMusicStates.set(roomId, state);
    return state;
  }

  // 🔥 HARD RESET (important fix)
  stopMusic(roomId) {
    this.roomMusicStates.delete(roomId);
  }

  getCurrentPosition(roomId) {
    const state = this.getState(roomId);
    if (!state.isPlaying) return state.pausedAt;
    return Date.now() - state.startedAt;
  }
}

module.exports = new RoomManager();
