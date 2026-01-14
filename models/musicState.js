const mongoose = require("mongoose");

const musicStateSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
    },

    // Current music metadata
    musicFile: {
      name: String,
      duration: Number, // milliseconds
      artist: String,
      fileSize: Number,
    },
    localFilePath: String, // Original local path (for cleanup)
    musicUrl: String, // ✅ ADDED - THIS WAS MISSING

    // Playback state
    isPlaying: {
      type: Boolean,
      default: false,
    },

    // Timestamp when music started (for sync)
    startedAt: {
      type: Date,
      default: null,
    },

    // Paused position (if paused)
    pausedAt: {
      type: Number, // milliseconds
      default: 0,
    },

    // Track all playback events
    playbackHistory: [
      {
        action: {
          type: String,
          enum: ["play", "pause", "resume", "stop", "seek"],
        },
        timestamp: Date,
        position: Number, // for seek events
      },
    ],

    // Host who's playing
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // Auto-delete after 24 hours
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MusicState", musicStateSchema);
