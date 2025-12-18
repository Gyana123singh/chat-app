// models/Room.js
const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      unique: true,
      index: true,
    },

    // models/Room.js
    creatorName: {
      type: String,
    },
    title: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    // ✅ NEW FIELD (IMPORTANT)
    mode: {
      type: String,
      enum: ["Game-Carrom", "Game-Ludo", "Chat"],
    },
    description: {
      type: String,
      default: "",
      maxlength: 500,
    },
    category: {
      type: String,
      enum: [
        "Gaming",
        "Music",
        "Sports",
        "Entertainment",
        "Education",
        "Other",
      ],
      default: "Other",
    },
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    participants: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        role: {
          type: String,
          enum: ["host", "listener"],
          default: "listener",
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    maxParticipants: {
      type: Number,
      default: null,
    },
    privacy: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "public",
    },
    tags: [String],
    coverImage: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    stats: {
      totalJoins: {
        type: Number,
        default: 0,
      },
      totalDuration: {
        type: Number,
        default: 0,
      },
      averageListeners: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Room", roomSchema);
