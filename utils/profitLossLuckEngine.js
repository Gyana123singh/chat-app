const ProfitLossConfig = require("../models/profitLossConfig");

async function calculateProfitLoss(amount) {
  let outcomes = [
    { type: "big_profit", chance: 20, percent: 30 },
    { type: "profit", chance: 20, percent: 10 },
    { type: "neutral", chance: 20, percent: 0 },
    { type: "loss", chance: 25, percent: -10 },
    { type: "big_loss", chance: 15, percent: -25 },
  ];

  try {
    const config = await ProfitLossConfig.findOne().lean();
    if (config && config.outcomes && config.outcomes.length === 5) {
      outcomes = config.outcomes;
    }
  } catch (error) {
    console.error("Error fetching ProfitLossConfig in LuckEngine, using defaults:", error);
  }

  const rand = Math.random() * 100;
  let cumulative = 0;

  for (const outcome of outcomes) {
    cumulative += outcome.chance;

    if (rand <= cumulative) {
      const coins = Math.floor((amount * outcome.percent) / 100);

      return {
        result: outcome.type,
        percentage: outcome.percent,
        coins,
      };
    }
  }

  return { result: "neutral", percentage: 0, coins: 0 };
}

module.exports = calculateProfitLoss;
