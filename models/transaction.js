// models/Transaction.js
const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, unique: true, required: true },
    userId: { type: String, required: true, ref: "User", index: true },
    type: {
      type: String,
      enum: ["GIFT_SEND", "COIN_RECHARGE"],
      required: true,
    },
    giftId: String,
    giftName: String,
    recipientId: String,
    coinsUsed: Number,
    coinsAdded: Number,
    razorpayOrderId: String,
    razorpayPaymentId: String,
    amount: Number,
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
    metadata: mongoose.Schema.Types.Mixed,
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    transactionType: {
      type: String,
      enum: ["gift", "purchase", "reward"],
      default: "gift",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "completed",
    },
    message: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ razorpayOrderId: 1 });
module.exports = mongoose.model("Transaction", transactionSchema);
