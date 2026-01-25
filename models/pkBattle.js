const mongoose = require("mongoose");

const pkBattleSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },

    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    leftUser: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      score: { type: Number, default: 0 },
    },

    rightUser: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      score: { type: Number, default: 0 },
    },

    mode: {
      type: String,
      enum: ["votes", "coins", "earning"],
      default: "coins",
    },

    duration: { type: Number, required: true }, // seconds

    status: {
      type: String,
      enum: ["pending", "running", "ended"],
      default: "pending",
    },

    startedAt: Date,
    endedAt: Date,

    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PKBattle", pkBattleSchema);
