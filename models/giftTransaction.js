const mongoose = require("mongoose");

const giftTransactionSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
  
    roomName: {
      type: String, // snapshot (keep this)
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

    recipientCount: {
      type: Number,
      required: true,
    },

    recipientIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

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
giftTransactionSchema.index({ roomId: 1, createdAt: -1 });
giftTransactionSchema.index({ recipientIds: 1 });

module.exports = mongoose.model("GiftTransaction", giftTransactionSchema);
