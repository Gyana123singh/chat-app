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
    },

    animationUrl: {
      type: String, // lottie json / mp4 / gif
      default: null,
    },

    price: {
      type: Number,
      min: 1,
    },

    validityDays: {
      type: Number,
      default: 7,
      min: 1,
    },

    category: {
      type: String,
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
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

storeGiftSchema.virtual("days").get(function () {
  return this.validityDays;
});

module.exports = mongoose.model("StoreGift", storeGiftSchema);
