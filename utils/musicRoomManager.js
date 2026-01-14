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
        locked: false,
        playedBy: null,
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
        locked: false,
        playedBy: null,
      }
    );
  }

  canPlay(roomId) {
    const state = this.getState(roomId);
    return !state.locked && !state.isPlaying;
  }

  playMusic(roomId, musicFile, playedBy) {
    const state = this.getState(roomId);

    state.musicFile = musicFile;
    state.isPlaying = true;
    state.startedAt = Date.now();
    state.pausedAt = 0;
    state.locked = true;
    state.playedBy = playedBy;

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
      locked: false,
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
