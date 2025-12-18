const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // 🔹 Firebase UID (Phone OTP)
    firebaseUid: {
      type: String,
      default: null,
      index: true,
    },

    username: {
      type: String,
      required: function () {
        return !this.googleId && !this.firebaseUid;
      },
      unique: true,
      trim: true,
      minlength: 3,
    },

    email: {
      type: String,
      required: function () {
        return !this.firebaseUid;
      },
      unique: true,
      sparse: true,
    },

    password: {
      type: String,
      required: function () {
        return !this.googleId && !this.firebaseUid;
      },
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
      unique: true,
      sparse: true,
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

/* 🔐 SAFE PASSWORD HASHING */
userSchema.pre("save", async function (next) {
  try {
    // ✅ Skip hashing for Google / Phone users
    if (!this.password) return next();

    // ✅ Hash only when password changes
    if (!this.isModified("password")) return next();

    this.password = await bcrypt.hash(this.password, 10);
    next();
  } catch (err) {
    next(err); // 🚨 critical for preventing crashes
  }
});

/* 🔑 Password comparison */
userSchema.methods.comparePassword = async function (password) {
  if (!this.password) return false;
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
