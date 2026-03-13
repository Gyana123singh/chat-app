const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: String,

    // 🆔 Public Account ID
    diiId: {
      type: String,
      unique: true,
    },

    username: {
      type: String,
      unique: true,
      trim: true,
      minlength: 3,
    },
    displayId: {
      type: Number,
      unique: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
    },

    password: {
      type: String,
      minlength: 6,
      select: false,
    },

    googleId: {
      type: String,
      default: null,
      index: true,
    },

    phone: {
      type: String,
      sparse: true,
      trim: true,
      default: undefined,
    },

    profile: {
      avatar: {
        type: String,
        default: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
      },

      badge: {
        type: String,
        default: null,
      },

      avatarSource: {
        type: String,
        enum: ["google", "custom"],
        default: "custom",
      },

      bio: {
        type: String,
        default: "",
        maxlength: 250,
      },

      language: {
        type: String,
        enum: ["English", "Hindi", "Tamil", "Telugu", "Urdu"],
        default: "English",
      },

      // ✅ FIXED FRAME STRUCTURE
      frame: {
        icon: {
          type: String,
          default: null,
        },
        expiresAt: {
          type: Date,
          default: null,
        },
      },

      ring: {
        type: String,
        default: null,
      },

      bubble: {
        type: String,
        default: null,
      },

      entranceEffect: {
        type: String,
        default: null,
      },

      theme: {
        type: String,
        enum: ["light", "dark"],
        default: "dark",
      },

      interests: [String],
    },

    coins: {
      type: Number,
      default: 0,
      min: 0,
    },

    stats: {
      followers: { type: Number, default: 0 },
      following: { type: Number, default: 0 },
      giftsReceived: { type: Number, default: 0 },
      totalHostingMinutes: { type: Number, default: 0 },
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: ["user", "host", "admin"],
      default: "user",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastSeen: {
      type: Date,
      default: Date.now,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    biometricEnabled: {
      type: Boolean,
      default: false,
    },

    accountProtection: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "High",
    },

    thirdParty: {
      google: { type: Boolean, default: false },
      facebook: { type: Boolean, default: false },
    },

    loginHistory: [
      {
        device: String,
        ip: String,
        location: String,
        loggedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    authProvider: {
      type: String,
      enum: ["email", "firebase-phone", "google"],
      default: "firebase-phone",
    },

    country: {
      type: String,
      enum: ["IN", "PK", "BD"],
    },

    countryCode: {
      type: String,
      enum: ["+91", "+92", "+880"],
    },

    totalSpent: {
      type: Number,
      default: 0,
    },

    totalEarned: {
      type: Number,
      default: 0,
    },

    level: {
      personal: {
        level: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
      },
      room: {
        level: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
      },
    },

    pkStats: {
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws: { type: Number, default: 0 },
      totalSupportSent: { type: Number, default: 0 },
      totalSupportReceived: { type: Number, default: 0 },
    },

    trophy: {
      totalContributions: { type: Number, default: 0 },
      totalCoinsEarned: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      longestStreak: { type: Number, default: 0 },
      lastContributionDate: Date,
      level: { type: Number, default: 1 },

      achievements: [
        {
          achievementId: String,
          achievementName: String,
          unlockedAt: Date,
        },
      ],
    },
  },
  { timestamps: true },
);

// Indexes
userSchema.index({ "stats.coins": -1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
