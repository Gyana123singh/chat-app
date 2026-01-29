const mongoose = require("mongoose");

const giftTransactionSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
    },

    recipientIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    recipientCount: {
      type: Number,
      required: true,
    },

    giftName: String,
    giftIcon: String,
    giftPrice: Number,

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },

    giftRarity: String,

    sendType: {
      type: String,
      enum: ["individual", "all_in_room", "all_on_mic"],
    },

    totalCoinsDeducted: {
      type: Number,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
  },
  { timestamps: true },
);

// Indexes
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });
giftTransactionSchema.index({ createdAt: -1 });
giftTransactionSchema.index({ recipientIds: 1 });

module.exports = mongoose.model("GiftTransaction", giftTransactionSchema);
