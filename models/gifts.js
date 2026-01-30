// models/Gift.js
const mongoose = require("mongoose");

const giftSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
    },
    name: { type: String },
    price: {
      type: Number,

      min: 1,
    },

    category: {
      type: String,
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
    // 🔥 THIS TELLS FRONTEND WHAT TO DO
    effectType: {
      type: String,
      enum: ["HOT", "LUCKY", "SIV", "CUSTOMIZED", "BAG"],
      default: "NONE",
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Gift", giftSchema);
