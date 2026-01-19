// models/Banner.js
const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    mediaUrl: { type: String, required: true },
    redirectUrl: { type: String },
    mediaType: {
      type: String,
      enum: ["image", "gif", "video"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Banner", bannerSchema);
