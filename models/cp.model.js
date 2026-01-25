const mongoose = require("mongoose");

const cpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },

    dailyCP: { type: Number, default: 0 },
    totalCP: { type: Number, default: 0 },

    dailyLimit: { type: Number, default: 8000 },

    isActive: { type: Boolean, default: false }, // 🔥 CP badge

    lastReset: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CP", cpSchema);
