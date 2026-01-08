const mongoose = require("mongoose");
const giftTransactionSchema = new mongoose.Schema({
  username: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
  isOnMic: { type: Boolean, default: false },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  giftId: { type: mongoose.Schema.Types.ObjectId, ref: "Gift" }, // ✅
  giftIcon: String,
  giftPrice: Number,
  giftCategory: String,
  giftRarity: String,
  
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model("GiftTransaction", giftTransactionSchema);
