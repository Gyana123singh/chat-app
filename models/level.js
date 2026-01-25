const mongoose = require("mongoose");

const levelSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },

    personal: {
      level: { type: Number, default: 1 },
      exp: { type: Number, default: 0 },
    },

    room: {
      level: { type: Number, default: 0 },
      exp: { type: Number, default: 0 },
    },

    // 🔥 DAILY LIMIT SYSTEM
    daily: {
      personalExpToday: { type: Number, default: 0 },
      lastReset: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Level", levelSchema);
