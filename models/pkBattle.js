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
      enum: ["votes", "coins", "earning","points"],
      default: "coins",
    },
    voters: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    rewardsDistributed: { type: Boolean, default: false },

    duration: { type: Number, required: true }, // seconds

    status: {
      type: String,
      enum: ["pending", "running", "ended"],
      default: "pending",
    },

    startedAt: Date,
    endedAt: Date,


    // ADD inside pkBattleSchema
    contributions: [
      {
        fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        giftId: { type: mongoose.Schema.Types.ObjectId, ref: "Gift" },
        value: Number,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    contributions: [
      {
        fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        giftId: { type: mongoose.Schema.Types.ObjectId, ref: "Gift" },
        value: Number,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    topSupporters: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        total: Number,
      },
    ],

    mvpSupporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PKBattle", pkBattleSchema);
