const mongoose = require("mongoose");

const storeGIftInventorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  giftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "StoreGift",
  },

  effectType: String,

  icon: String,
  animationUrl: String,

  duration: {
    type: Number, // days
    default: 1,
  },

  expiresAt: {
    type: Date,
  },

  isActive: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model(
  "StoreGIftInventory",
  storeGIftInventorySchema
);
