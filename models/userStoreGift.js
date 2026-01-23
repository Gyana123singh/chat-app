const mongoose = require("mongoose");

const userStoreGiftSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreGift",
      required: true,
    },
    giftName: String,
    giftIcon: String,
    giftPrice: Number,
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    expiresAt: {
      type: Date,
      default: null, // null = never expires
    },
    receivedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Index for user's gifts
userStoreGiftSchema.index({ createdAt: -1 });
userStoreGiftSchema.index({ isUsed: 1 });

module.exports = mongoose.model("UserStoreGift", userStoreGiftSchema);
