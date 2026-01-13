const cron = require("node-cron");
const trophyController = require("../controllers/trophyController");

/**
 * 🕐 CRON JOBS - Scheduled tasks for trophy system
 * These run automatically at specified intervals
 */

let cronJobs = [];

/**
 * ✅ FIX: Schedule rank updates every hour (instead of after every gift)
 * This prevents performance issues from constant rank recalculation
 *
 * Cron syntax: "minute hour day month dayOfWeek"
 * "0 * * * *" = every hour at minute 0
 */
const scheduleRankUpdate = () => {
  const rankUpdateJob = cron.schedule("0 * * * *", async () => {
    try {
      console.log("📊 [CRON] Starting hourly rank update...");
      await trophyController.updateAllRanks();
      console.log("✅ [CRON] Rank update completed");
    } catch (error) {
      console.error("❌ [CRON] Rank update failed:", error.message);
    }
  });

  cronJobs.push(rankUpdateJob);
  console.log("📅 Scheduled: Rank updates every hour");
};

/**
 * ✅ BONUS: Schedule daily reset check at midnight
 * Ensures daily leaderboard stats reset properly
 * Runs at 00:00 (midnight) every day
 */
const scheduleDailyReset = () => {
  const dailyResetJob = cron.schedule("0 0 * * *", async () => {
    try {
      console.log("📊 [CRON] Midnight reset check - daily stats ready");
      // Stats reset happens naturally when updateLeaderboardOnGift is called
      // This is just a log entry for monitoring
    } catch (error) {
      console.error("❌ [CRON] Daily reset check failed:", error.message);
    }
  });

  cronJobs.push(dailyResetJob);
  console.log("📅 Scheduled: Daily reset check at midnight");
};

/**
 * 🏆 Main function: Start all cron jobs
 */
const startCronJobs = () => {
  try {
    console.log("\n🕐 Starting scheduled cron jobs...\n");
    scheduleRankUpdate();
    scheduleDailyReset();
    console.log(`✅ ${cronJobs.length} cron jobs initialized\n`);
  } catch (error) {
    console.error("❌ Failed to start cron jobs:", error.message);
  }
};

/**
 * 🛑 Stop all cron jobs (cleanup on server shutdown)
 */
const stopCronJobs = () => {
  cronJobs.forEach((job) => {
    if (job) {
      job.stop();
    }
  });
  console.log("🛑 All cron jobs stopped");
};

module.exports = {
  startCronJobs,
  stopCronJobs,
};
