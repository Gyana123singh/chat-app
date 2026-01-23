const mongoose = require("mongoose");

const storeGiftTransactionSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreGift",
      required: true,
    },
    giftName: String,
    giftIcon: String,
    giftPrice: Number,
    giftCategory: String,
    giftRarity: String,
    sendType: {
      type: String,
      enum: ["individual", "all_in_room", "all_on_mic"],
      required: true,
    },
    quantitySent: {
      type: Number,
      default: 1,
      min: 1,
    },
    totalCoinsDeducted: {
      type: Number,
      required: true,
    },
    recipientCount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    failureReason: String,
    completedAt: Date,
  },
  { timestamps: true },
);

// Indexes for analytics
storeGiftTransactionSchema.index({ senderId: 1, createdAt: -1 });
storeGiftTransactionSchema.index({ createdAt: -1 });
storeGiftTransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model(
  "StoreGiftTransaction",
  storeGiftTransactionSchema,
);
