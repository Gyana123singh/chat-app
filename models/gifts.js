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
      required: true,
    },
    name: { String },
    price: {
      type: Number,
      required: true,
      min: 1,
    },
    category: {
      type: String,
      enum: ["flower", "luxury", "emoji", "special"],
      default: "flower",
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

module.exports = mongoose.model("Gift", giftSchema);
