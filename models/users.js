const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // 🔹 Firebase UID (Phone OTP)
    firebaseUid: String,
    createdAt: { type: Date, default: Date.now },

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

    // 🔹 Google Login
    googleId: {
      type: String,
      default: null,
      index: true,
    },

    // 🔹 Phone OTP
    phone: {
      type: String,
      sparse: true,
      trim: true,
      default: undefined,
    },

    profile: {
      avatar: {
        type: String,
        default: "https://via.placeholder.com/150",
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
      theme: {
        type: String,
        enum: ["light", "dark"],
        default: "dark",
      },
      interests: [String],
    },

    stats: {
      coins: { type: Number, default: 0 },
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
