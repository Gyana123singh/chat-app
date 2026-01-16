const mongoose = require("mongoose");

const storeCategorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["ENTRANCE", "FRAME", "RING", "BUBBLE", "THEME", "EMOJI", "NONE"],
    },
    title: {
      type: String, // optional display name
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StoreCategory", storeCategorySchema);
