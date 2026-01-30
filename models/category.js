const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
   
    type: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Category", categorySchema);
