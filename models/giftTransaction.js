const mongoose = require("mongoose");

const giftTransactionSchema = new mongoose.Schema(
  {
    // 🔁 Use STRING roomId (UUID), not required
    roomIdString: {
      type: String,
      default: null,
      index: true,
    },

    senderId: {
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
    giftCategory: String,
    giftRarity: String,

    sendType: {
      type: String,
      enum: ["individual", "all_in_room", "all_on_mic", "pk"],
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

    totalCoinsDeducted: {
      type: Number,
      required: true,
    },

    quantity: {
      type: Number,
      default: 1,
    },

    status: {
      type: String,
      enum: ["completed", "failed"],
      default: "completed",
    },
  },
  { timestamps: true },
);

// indexes
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });
giftTransactionSchema.index({ roomIdString: 1, createdAt: -1 });
giftTransactionSchema.index({ recipientIds: 1 });

module.exports = mongoose.model("GiftTransaction", giftTransactionSchema);
