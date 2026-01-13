const cron = require("node-cron");
const trophyController = require("../controllers/trophyController");

// Run rank update every day at midnight
cron.schedule("0 0 * * *", async () => {
  console.log("🏆 Running daily leaderboard rank update...");
  try {
    await trophyController.updateAllRanks();
  } catch (error) {
    console.error("Error in rank update cron:", error);
  }
});

// Run streak reset if needed (daily check)
cron.schedule("0 1 * * *", async () => {
  console.log("🔄 Checking user streaks...");
  // Implement streak reset logic if user didn't contribute today
});

module.exports = { startCronJobs: () => {} };
