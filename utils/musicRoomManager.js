class RoomManager {
  constructor() {
    this.roomMusicStates = new Map();
  }

  initRoom(roomId) {
    if (!this.roomMusicStates.has(roomId)) {
      this.roomMusicStates.set(roomId, {
        musicFile: null,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: null, // ALWAYS STRING
      });
    }
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
    const state = this.getState(roomId);

    state.musicFile = musicFile;
    state.isPlaying = true;
    state.startedAt = Date.now();
    state.pausedAt = 0;
    state.playedBy = playedByUserId.toString();

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

  stopMusic(roomId) {
    this.roomMusicStates.set(roomId, {
      musicFile: null,
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
      playedBy: null,
    });
  }

  getCurrentPosition(roomId) {
    const state = this.getState(roomId);
    if (!state.isPlaying) return state.pausedAt;
    return Date.now() - state.startedAt;
  }
}

module.exports = new RoomManager();
