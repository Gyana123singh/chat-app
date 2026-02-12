const cron = require("node-cron");
const Leaderboard = require("../models/trophyLeaderBoard");
const trophyController = require("../controllers/trophyController");

/**
 * 🕐 TROPHY CRON JOBS
 */

let cronJobs = [];

/**
 * 🔄 Update ranks every hour
 */
const scheduleRankUpdate = () => {
  const job = cron.schedule("0 * * * *", async () => {
    try {
      console.log("📊 [CRON] Updating ranks...");
      await trophyController.updateAllRanks();
      console.log("✅ [CRON] Rank update done");
    } catch (error) {
      console.error("❌ [CRON] Rank update failed:", error.message);
    }
  });

  cronJobs.push(job);
};

/**
 * 🧹 Reset DAILY leaderboard (every day at 00:00)
 */
const scheduleDailyReset = () => {
  const job = cron.schedule("0 0 * * *", async () => {
    try {
      console.log("🧹 [CRON] Resetting DAILY leaderboard...");

      await Leaderboard.updateMany({}, {
        $set: {
          "daily.coins": 0,
          "daily.giftsReceived": 0,
          "daily.totalValue": 0,
          "rank.daily": 0,
        },
      });

      console.log("✅ [CRON] Daily reset done");
    } catch (error) {
      console.error("❌ [CRON] Daily reset failed:", error.message);
    }
  });

  cronJobs.push(job);
};

/**
 * 🧹 Reset WEEKLY leaderboard (every Sunday 00:00)
 */
const scheduleWeeklyReset = () => {
  const job = cron.schedule("0 0 * * 0", async () => {
    try {
      console.log("🧹 [CRON] Resetting WEEKLY leaderboard...");

      await Leaderboard.updateMany({}, {
        $set: {
          "weekly.coins": 0,
          "weekly.giftsReceived": 0,
          "weekly.totalValue": 0,
          "rank.weekly": 0,
        },
      });

      console.log("✅ [CRON] Weekly reset done");
    } catch (error) {
      console.error("❌ [CRON] Weekly reset failed:", error.message);
    }
  });

  cronJobs.push(job);
};

/**
 * 🧹 Reset MONTHLY leaderboard (1st day of month 00:00)
 */
const scheduleMonthlyReset = () => {
  const job = cron.schedule("0 0 1 * *", async () => {
    try {
      console.log("🧹 [CRON] Resetting MONTHLY leaderboard...");

      await Leaderboard.updateMany({}, {
        $set: {
          "monthly.coins": 0,
          "monthly.giftsReceived": 0,
          "monthly.totalValue": 0,
          "rank.monthly": 0,
        },
      });

      console.log("✅ [CRON] Monthly reset done");
    } catch (error) {
      console.error("❌ [CRON] Monthly reset failed:", error.message);
    }
  });

  cronJobs.push(job);
};

/**
 * ▶️ Start all cron jobs
 */
const startCronJobs = () => {
  try {
    console.log("🕐 Starting trophy cron jobs...");
    scheduleRankUpdate();
    scheduleDailyReset();
    scheduleWeeklyReset();
    scheduleMonthlyReset();
    console.log(`✅ ${cronJobs.length} cron jobs started`);
  } catch (error) {
    console.error("❌ Failed to start cron jobs:", error.message);
  }
};

/**
 * ⏹ Stop all cron jobs
 */
const stopCronJobs = () => {
  cronJobs.forEach((job) => job && job.stop());
  console.log("🛑 All cron jobs stopped");
};

module.exports = {
  startCronJobs,
  stopCronJobs,
};
