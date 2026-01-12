// models/Gift.js
const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
    },
    categoryName: { type: String },
    price: {
      type: Number,

      min: 1,
    },
    // ✅ FIX HERE
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreCategory",
      required: true,
    },
    animationUrl: {
      type: String,
      default: null,
    },
    rarity: {
      type: String,
      enum: ["common", "rare", "epic", "legendary"],
      default: "common",
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreGift", storeSchema);
