const mongoose = require("mongoose");

const storeCategorySchema = new mongoose.Schema(
  {
    type: {
      type: String,
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
