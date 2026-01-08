// models/Block.model.js
const mongoose = require("mongoose");

const blockSchema = new mongoose.Schema(
  {
    blocker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    blocked: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    blockedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Prevent duplicate block
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });

module.exports = mongoose.model("Block", blockSchema);
