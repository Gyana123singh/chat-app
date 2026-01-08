// models/Gift.js
const mongoose = require("mongoose");

const giftSchema = new mongoose.Schema(
  {
    username: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
    isOnMic: { type: Boolean, default: false },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    giftName: String,
    giftPrice: Number,
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
      required: true,
    },
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

module.exports = mongoose.model("GiftTransaction", giftSchema);
