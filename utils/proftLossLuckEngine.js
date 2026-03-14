function calculateProfitLoss(amount) {
  if (amount < 5000) {
    return { result: "none", percentage: 0, coins: 0 };
  }

  const outcomes = [
    { type: "big_profit", chance: 20, percent: 30 },
    { type: "profit", chance: 20, percent: 10 },
    { type: "neutral", chance: 20, percent: 0 },
    { type: "loss", chance: 25, percent: -10 },
    { type: "big_loss", chance: 15, percent: -25 },
  ];

  const rand = Math.random() * 100;
  console.log("🎰 RANDOM VALUE:", rand);

  let cumulative = 0;

  for (const outcome of outcomes) {
    cumulative += outcome.chance;

    if (rand <= cumulative) {
      const coins = Math.floor((amount * outcome.percent) / 100);

      console.log("🎰 RESULT:", outcome.type);

      return {
        result: outcome.type,
        percentage: outcome.percent,
        coins,
      };
    }
  }

  return { result: "neutral", percentage: 0, coins: 0 };
}