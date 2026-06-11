class RoomManager {
  constructor() {
    this.roomMusicStates = new Map();
  }

  // ✅ SAFE INIT (no overwrite)
  initRoom(roomId) {
    if (!this.roomMusicStates.has(roomId)) {
      this.roomMusicStates.set(roomId, {
        currentTrackId: null,
        musicFile: null,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: null,
        trackOwnerId: null,
        duration: 0,
      });
    }
  }

  getState(roomId) {
    return (
      this.roomMusicStates.get(roomId) || {
        currentTrackId: null,
        musicFile: null,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
        playedBy: null,
        trackOwnerId: null,
        duration: 0,
      }
    );
  }

  playMusic(roomId, musicFile, playedByUserId, trackOwnerId = null, currentTrackId = null, duration = 0) {
    const state = {
      currentTrackId: currentTrackId ? currentTrackId.toString() : null,
      musicFile,
      isPlaying: true,
      startedAt: Date.now(),
      pausedAt: 0,
      playedBy: playedByUserId.toString(),
      trackOwnerId: trackOwnerId ? trackOwnerId.toString() : null,
      duration: Number(duration) || 0,
    };

    this.roomMusicStates.set(roomId, state);
    return state;
  }

  pauseMusic(roomId, position) {
    const state = this.getState(roomId);
    state.isPlaying = false;
    state.pausedAt = Math.max(0, Number(position) || 0);
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  resumeMusic(roomId) {
    const state = this.getState(roomId);
    state.isPlaying = true;
    state.startedAt = Date.now() - state.pausedAt * 1000;
    state.pausedAt = 0;
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  stopMusic(roomId) {
    this.roomMusicStates.set(roomId, {
      currentTrackId: null,
      musicFile: null,
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
      playedBy: null,
      trackOwnerId: null,
      duration: 0,
    });
  }

  getCurrentPosition(roomId) {
    const state = this.getState(roomId);

    if (!state.isPlaying) return state.pausedAt;

    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000); // seconds
    if (state.duration > 0 && elapsed > state.duration) {
      return state.duration;
    }
    return Math.max(0, elapsed);
  }

  seekTo(roomId, position) {
    const state = this.getState(roomId);
    const clamped = Math.max(0, Math.min(Number(position) || 0, state.duration || Infinity));
    if (state.isPlaying) {
      state.startedAt = Date.now() - clamped * 1000;
      state.pausedAt = 0;
    } else {
      state.pausedAt = clamped;
    }
    this.roomMusicStates.set(roomId, state);
    return state;
  }
}

module.exports = new RoomManager();
