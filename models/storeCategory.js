const mongoose = require("mongoose");

const storeCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // 🔥 THIS IS CRITICAL
    type: {
      type: String,
      enum: ["ENTRANCE", "FRAME", "RING", "BUBBLE", "THEME", "EMOJI", "NORMAL"],
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreCategory", storeCategorySchema);
