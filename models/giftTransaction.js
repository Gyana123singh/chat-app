const mongoose = require("mongoose");
const giftTransactionSchema = new mongoose.Schema(
  {
    username: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
    isOnMic: { type: Boolean, default: false },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    giftId: { type: mongoose.Schema.Types.ObjectId, ref: "Gift" }, // ✅
    giftName: String,
    giftIcon: String,
    giftPrice: Number,
    giftCategory: String,
    giftRarity: String,
    // Track who sent and what type
    sendType: {
      type: String,
      enum: ["individual", "all_in_room", "all_on_mic"],
      required: true,
    },
    totalCoinsDeducted: {
      type: Number,
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
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indexes for analytics
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });
giftTransactionSchema.index({ roomId: 1, createdAt: -1 });
giftTransactionSchema.index({ recipientIds: 1 });
module.exports = mongoose.model("GiftTransaction", giftTransactionSchema);
