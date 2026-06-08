const mongoose = require("mongoose");

const profitLossConfigSchema = new mongoose.Schema(
  {
    outcomes: [
      {
        type: {
          type: String,
          required: true,
          enum: ["big_profit", "profit", "neutral", "loss", "big_loss"],
        },
        chance: {
          type: Number,
          required: true,
          min: 0,
          max: 100,
        },
        percent: {
          type: Number,
          required: true,
        },
      },
    ],
    minCoinsRequired: {
      type: Number,
      required: true,
      default: 5000,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProfitLossConfig", profitLossConfigSchema);
