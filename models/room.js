// models/Room.js
const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      unique: true,
    },

    // models/Room.js
    creatorName: {
      type: String,
    },
    creatorAvatar: {
      type: String,
      default: null,
    },
    creatorEmail: {
      type: String,
      default: null,
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
    // models/room.js (ADD THIS FIELD ONLY)
    activePK: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PKBattle",
      default: null,
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
    creatorRole: {
      type: String,
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
        isMuted: { type: Boolean, default: false },
        isSpeaking: { type: Boolean, default: false },
        avatar: String,
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
    currentParticipants: {
      type: Number,
      default: 0,
    },
    seatCount: {
      type: Number,
      default: 12,
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
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lockedSeats: {
      type: [Number], // e.g. [1,2,3,4]
      default: [],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Room", roomSchema);
