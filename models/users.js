// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: function () {
        return !this.googleId; // username not required for Google users
      },
      unique: true,
      trim: true,
      minlength: 3,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: function () {
        return !this.googleId; // password not required for Google users
      },
      minlength: 6,
      select: false,
    },

    // ✅ Google Auth
    googleId: {
      type: String,
      default: null,
      index: true,
    },

    phone: {
      type: String,
      default: null,
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
      enum: ["user", "moderator", "admin"],
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
  },
  { timestamps: true }
);

/* 🔐 Hash password only if exists */
userSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (password) {
  if (!this.password) return false;
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
