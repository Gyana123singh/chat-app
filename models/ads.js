// models/Ad.js
const mongoose = require("mongoose");

const adSchema = new mongoose.Schema(
  {
    mediaUrl: { type: String, required: true },
    redirectLink: { type: String },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ads", adSchema);
