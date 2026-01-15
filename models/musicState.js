const mongoose = require("mongoose");

const musicStateSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true },

    musicFile: {
      name: String,
      fileSize: Number,
    },

    localFilePath: { type: String, default: null },
    musicUrl: { type: String, default: null },

    isPlaying: { type: Boolean, default: false },

    startedAt: { type: Date, default: null },
    pausedAt: { type: Number, default: 0 },

    playedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MusicState", musicStateSchema);
