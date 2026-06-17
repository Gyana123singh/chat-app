const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      unique: true,
    },

    creatorName: String,

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

    // ✅ FIXED ENUM (safe)
    mode: {
      type: String,
      enum: ["Game-Carrom", "Game-Ludo", "Chat", "chat"], // 🔥 allow both
      default: "Chat",
    },

    // ✅ SINGLE description (clean)
    description: {
      type: String,
      default: "",
      maxlength: 150,
    },

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

    creatorRole: String,

    participants: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        role: {
          type: String,
          enum: ["host", "listener", "admin"],
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
      default: 10,
    },

    privacy: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "public",
    },

    password: {
      type: String,
      default: null,
      select: false,
    },

    isLocked: {
      type: Boolean,
      default: false,
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
    status: {
      type: String,
      enum: ["active", "host_left", "ended"],
      default: "active",
    },

    hostOnline: {
      type: Boolean,
      default: true,
    },

    hostLeftAt: {
      type: Date,
      default: null,
    },

    allowAudienceStay: {
      type: Boolean,
      default: true,
    },

    currentUsers: {
      type: Number,
      default: 1,
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
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
      type: [Number],
      default: [],
    },

    roomProfiles: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        avatar: {
          type: String,
          default: null,
        },
      },
    ],
    isHelpRoom: {
      type: Boolean,
      default: false,
    },
    // Mark rooms created by admin (permanent/help-line rooms)
    createdByAdmin: {
      type: Boolean,
      default: false,
    },
    helpEmails: {
      type: [String],
      default: [],
    },
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    kickedUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        kickedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isChatEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Room", roomSchema);
