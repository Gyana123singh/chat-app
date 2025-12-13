const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, index: true, sparse: true },
    phone: { type: String, index: true, sparse: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    passwordHash: String, // optional if you support password sign-up
    oauthProvider: String, // 'google' | 'facebook' | null
    oauthProviderId: String,
    googleId: String,
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
