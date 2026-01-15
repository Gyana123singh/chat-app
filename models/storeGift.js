const mongoose = require("mongoose");

const storeGiftSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    icon: {
      type: String,
      required: true,
    },

    animationUrl: {
      type: String, // lottie json / mp4 / gif
      default: null,
    },

    price: {
      type: Number,
      required: true,
      min: 1,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreCategory",
      required: true,
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
      enum: ["ENTRANCE", "FRAME", "RING", "BUBBLE", "THEME", "EMOJI", "NONE"],
      default: "NONE",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreGift", storeGiftSchema);
