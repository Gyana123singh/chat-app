const mongoose = require("mongoose");

const musicStateSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true },

    musicFile: {
      name: String,
      fileSize: Number,
    },

    localFilePath: String,
    musicUrl: String,

    isPlaying: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },

    startedAt: { type: Date, default: null },
    pausedAt: { type: Number, default: 0 },

    playedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MusicState", musicStateSchema);
