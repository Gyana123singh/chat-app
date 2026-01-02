// models/CoinPlan.js
const mongoose = require("mongoose");

const coinPlanSchema = new mongoose.Schema({
  amount: Number,
  coins: Number, // base coins
  bonusCoins: Number,
  totalCoins: Number, // final coins user gets
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model("CoinPlan", coinPlanSchema);
