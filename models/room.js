const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    username: {
      type: String,
      required: true,
    },
    avatar: {
      type: String,
      default: "/avatar.png",
    },
    role: {
      type: String,
      enum: ["host", "listener"],
      default: "listener",
    },
    isMuted: {
      type: Boolean,
      default: false,
    },
    isSpeaking: {
      type: Boolean,
      default: false,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      unique: true,
      index: true,
    },

    /* =========================
       CREATOR SNAPSHOT
    ========================== */
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    creatorName: String,
    creatorAvatar: String,
    creatorEmail: String,

    /* =========================
       ROOM META
    ========================== */
    title: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
      maxlength: 500,
      default: "",
    },
    mode: {
      type: String,
      enum: ["Game-Carrom", "Game-Ludo", "Chat"],
      required: true,
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
      index: true,
    },
    tags: [String],
    coverImage: String,

    /* =========================
       ROOM STATE
    ========================== */
    participants: [participantSchema],
    maxParticipants: {
      type: Number,
      default: 6,
    },
    privacy: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "public",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: Date,

    /* =========================
       STATS
    ========================== */
    stats: {
      totalJoins: { type: Number, default: 0 },
      activeUsers: { type: Number, default: 0 },
      totalDuration: { type: Number, default: 0 },
      averageListeners: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/* =========================
   INDEXES
========================== */
roomSchema.index({ category: 1, isActive: 1 });
roomSchema.index({ "participants.user": 1 });

module.exports = mongoose.model("Room", roomSchema);
