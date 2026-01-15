const mongoose = require("mongoose");

const storeCategorySchema = new mongoose.Schema(
  {
    // 🔥 THIS IS CRITICAL
    type: {
      type: String,
      enum: ["ENTRANCE", "FRAME", "RING", "BUBBLE", "THEME", "EMOJI", "NORMAL"],
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreCategory", storeCategorySchema);
