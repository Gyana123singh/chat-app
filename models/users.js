const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true, // 🔥 REQUIRED for all users
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      required: true, // 🔥 MUST
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: false, // 🔥 Google users have no password
      select: false,
    },

    googleId: {
      type: String,
      unique: true,
      sparse: true, // 🔥 ALLOWS multiple non-google users
    },

    profile: {
      avatar: {
        type: String,
        default: "https://via.placeholder.com/150",
      },
    },

    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    role: {
      type: String,
      enum: ["user", "moderator", "admin"],
      default: "user",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// 🔐 hash password only if exists
userSchema.pre("save", async function (next) {
  if (!this.password) return next();
  if (!this.isModified("password")) return next();

  this.password = await bcrypt.hash(this.password, 10);
  next();
});

module.exports = mongoose.model("User", userSchema);
