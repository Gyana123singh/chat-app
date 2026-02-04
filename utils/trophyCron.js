const cron = require("node-cron");
const Leaderboard = require("../models/trophyLeaderBoard");
const { updateAllRanks } = require("../controllers/trophyController");

// 🕛 Daily reset at 00:00
cron.schedule("0 0 * * *", async () => {
  console.log("🕛 Daily trophy reset");

  await Leaderboard.updateMany(
    {},
    {
      $set: {
        "daily.coins": 0,
        "daily.giftsReceived": 0,
        "daily.totalValue": 0,
        "daily.lastUpdated": null, // ✅ reset timestamp too
      },
    },
  );

  await updateAllRanks();
});

// 🗓️ Weekly reset (Sunday 00:00)
cron.schedule("0 0 * * 0", async () => {
  console.log("🗓️ Weekly trophy reset");

  await Leaderboard.updateMany(
    {},
    {
      $set: {
        "weekly.coins": 0,
        "weekly.giftsReceived": 0,
        "weekly.totalValue": 0,
        "weekly.lastUpdated": null, // ✅ correct field
      },
    },
  );

  await updateAllRanks();
});

// 📅 Monthly reset (1st day 00:00)
cron.schedule("0 0 1 * *", async () => {
  console.log("📅 Monthly trophy reset");

  await Leaderboard.updateMany(
    {},
    {
      $set: {
        "monthly.coins": 0,
        "monthly.giftsReceived": 0,
        "monthly.totalValue": 0,
        "monthly.lastUpdated": null, // ✅ reset timestamp too
      },
    },
  );

  await updateAllRanks();
});
