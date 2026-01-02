const mongoose = require("mongoose");

const coinMappingSchema = new mongoose.Schema(
  {
    rate: {
      type: Number,
      required: true,
      min: 1, // 1 INR minimum
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("coinMapping", coinMappingSchema);
