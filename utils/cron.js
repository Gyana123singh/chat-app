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
const performMonthlyReset = async () => {
  console.log("🧹 [CRON] Resetting MONTHLY leaderboard & user stats...");
  await Leaderboard.updateMany({}, {
    $set: {
      "monthly.coins": 0,
      "monthly.giftsReceived": 0,
      "monthly.totalValue": 0,
      "rank.monthly": 0,
    },
  });

  const User = require("../models/users");
  await User.updateMany({}, {
    $set: {
      "stats.monthlySent": 0,
      "stats.monthlyReceived": 0,
    },
  });
  console.log("✅ [CRON] Monthly reset done");
};

const scheduleMonthlyReset = () => {
  const job = cron.schedule("0 0 1 * *", async () => {
    try {
      await performMonthlyReset();
    } catch (error) {
      console.error("❌ [CRON] Monthly reset failed:", error.message);
    }
  });

  cronJobs.push(job);
};

/**
 * 🔄 Check and perform monthly reset on startup if new month has started
 */
const checkAndRunMonthlyResetOnStartup = async () => {
  try {
    const mongoose = require("mongoose");
    const SystemMeta = mongoose.models.SystemMeta || mongoose.model("SystemMeta", new mongoose.Schema({
      key: { type: String, unique: true },
      value: String,
      updatedAt: { type: Date, default: Date.now }
    }));

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;

    const meta = await SystemMeta.findOne({ key: "lastMonthlyReset" });
    if (!meta || meta.value !== currentMonthKey) {
      console.log(`🧹 [CRON] New month detected (${currentMonthKey}). Resetting monthly trophy & gift stats...`);
      await performMonthlyReset();
      await SystemMeta.findOneAndUpdate(
        { key: "lastMonthlyReset" },
        { value: currentMonthKey, updatedAt: new Date() },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error("❌ Startup monthly reset check failed:", err.message);
  }
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
    checkAndRunMonthlyResetOnStartup();
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
  performMonthlyReset,
};
