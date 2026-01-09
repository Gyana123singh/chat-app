const mongoose = require("mongoose");

const coinPlanSchema = new mongoose.Schema(
  {
    amount: { type: Number }, // ₹
    coins: { type: Number }, // base coins
    bonusCoins: { type: Number, default: 0 },
    totalCoins: { type: Number }, // final coins
    discount: { type: Number, default: 0 }, // optional: % off label
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CoinPlan", coinPlanSchema);
