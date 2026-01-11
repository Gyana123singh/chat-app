// Manages room-specific music state (in-memory cache)
class RoomManager {
  constructor() {
    this.roomMusicStates = new Map(); // roomId -> musicState
  }

  // Initialize music state for a room
  initRoom(roomId) {
    this.roomMusicStates.set(roomId, {
      musicFile: null,
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
    });
  }

  // Get current music state
  getState(roomId) {
    return (
      this.roomMusicStates.get(roomId) || {
        musicFile: null,
        isPlaying: false,
        startedAt: null,
        pausedAt: 0,
      }
    );
  }

  // Start playing music
  playMusic(roomId, musicFile) {
    const state = this.getState(roomId);
    state.musicFile = musicFile;
    state.isPlaying = true;
    state.startedAt = Date.now();
    state.pausedAt = 0;
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  // Pause music
  pauseMusic(roomId, currentPosition) {
    const state = this.getState(roomId);
    state.isPlaying = false;
    state.pausedAt = currentPosition;
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  // Resume music
  resumeMusic(roomId) {
    const state = this.getState(roomId);
    state.isPlaying = true;
    // Recalculate startedAt to account for pause duration
    state.startedAt = Date.now() - state.pausedAt;
    state.pausedAt = 0;
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  // Stop music
  stopMusic(roomId) {
    const state = this.getState(roomId);
    state.musicFile = null;
    state.isPlaying = false;
    state.startedAt = null;
    state.pausedAt = 0;
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  // Seek to position
  seekMusic(roomId, position) {
    const state = this.getState(roomId);
    if (state.isPlaying) {
      state.startedAt = Date.now() - position;
    } else {
      state.pausedAt = position;
    }
    this.roomMusicStates.set(roomId, state);
    return state;
  }

  // Calculate current position
  getCurrentPosition(roomId) {
    const state = this.getState(roomId);

    if (!state.isPlaying) {
      return state.pausedAt;
    }

    const elapsedTime = Date.now() - state.startedAt;
    return Math.min(elapsedTime, state.musicFile?.duration || 0);
  }

  // Clean up room
  deleteRoom(roomId) {
    this.roomMusicStates.delete(roomId);
  }
}

module.exports = new RoomManager();
