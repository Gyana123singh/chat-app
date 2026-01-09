// models/User.js - REFACTORED
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: String,

    // 🆔 Public Account ID
    diiId: {
      type: String,
      unique: true,
      index: true,
    },

    username: {
      type: String,
      unique: true,
      trim: true,
      minlength: 3,
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
      avatarSource: {
        type: String,
        enum: ["google", "custom"],
        default: "custom",
      },
      bio: { type: String, default: "", maxlength: 250 },
      language: {
        type: String,
        enum: ["English", "Hindi", "Tamil", "Telugu", "Urdu"],
        default: "English",
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
      min: 0, // ← Prevent negative coins
    },
    stats: {
      followers: { type: Number, default: 0 },
      following: { type: Number, default: 0 },
      giftsReceived: { type: Number, default: 0 },
      totalHostingMinutes: { type: Number, default: 0 },
    },

    isVerified: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ["user", "host", "admin"],
      default: "user",
    },
    isActive: { type: Boolean, default: true },

    lastSeen: {
      type: Date,
      default: Date.now,
    },

    // 🔐 SECURITY
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

    // 🔗 THIRD PARTY BIND
    thirdParty: {
      google: { type: Boolean, default: false },
      facebook: { type: Boolean, default: false },
    },

    // 🧾 LOGIN HISTORY
    loginHistory: [
      {
        device: String,
        ip: String,
        location: String,
        loggedAt: { type: Date, default: Date.now },
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
  },
  { timestamps: true }
);

// ✅ Index for coin-based queries (leaderboards, etc.)
userSchema.index({ "stats.coins": -1 });

// ✅ Index for user activity queries
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
