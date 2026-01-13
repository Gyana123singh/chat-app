const Leaderboard = require("../models/trophyLeaderBoard");
const User = require("../models/users");
const GiftTransaction = require("../models/giftTransaction");

/**
 * ⏰ Utility: Get period boundaries
 */
const getPeriodBoundaries = () => {
  const now = new Date();

  // Start of today (00:00:00)
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );

  // Start of this week (Sunday 00:00:00)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  // Start of this month (1st day 00:00:00)
  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0
  );

  return { now, startOfDay, startOfWeek, startOfMonth };
};

/**
 * 🏆 GET LEADERBOARD - Main trophy page function
 * Returns top contributors with daily/weekly/monthly stats
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const { period = "daily", page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;

    // Validate period
    if (!["daily", "weekly", "monthly", "allTime"].includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Invalid period. Must be daily, weekly, monthly, or allTime",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortField = `${period}.coins`;

    // Get leaderboard data
    const leaderboard = await Leaderboard.find()
      .populate("userId", "username profile.avatar")
      .sort({ [sortField]: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const totalCount = await Leaderboard.countDocuments();

    // Get user's rank if authenticated
    let userRank = null;
    let userStats = null;

    if (userId) {
      const userLeaderboard = await Leaderboard.findOne({ userId });
      if (userLeaderboard) {
        // Count how many users have more coins than this user
        const usersAbove = await Leaderboard.countDocuments({
          [sortField]: { $gt: userLeaderboard[period].coins },
        });
        userRank = usersAbove + 1;
        userStats = userLeaderboard[period];
      }
    }

    // Format response
    const formattedLeaderboard = leaderboard.map((entry, index) => ({
      rank: skip + index + 1,
      userId: entry.userId?._id,
      username: entry.userId?.username || "Unknown",
      avatar: entry.userId?.profile?.avatar || null,
      coins: entry[period].coins,
      giftsReceived: entry[period].giftsReceived,
      totalValue: entry[period].totalValue,
      level: entry.level || 1,
      badges: entry.badges || [],
    }));

    res.status(200).json({
      success: true,
      period,
      leaderboard: formattedLeaderboard,
      userRank: userRank || null,
      userStats: userStats || null,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ getLeaderboard error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching leaderboard",
      error: error.message,
    });
  }
};

/**
 * 🏆 GET USER CONTRIBUTION STATS
 * Used for the trophy page "Contribution" section
 */
exports.getUserContributionStats = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Get leaderboard entry
    const leaderboard = await Leaderboard.findOne({ userId });

    if (!leaderboard) {
      return res.status(200).json({
        success: true,
        data: {
          daily: { coins: 0, giftsReceived: 0, totalValue: 0 },
          weekly: { coins: 0, giftsReceived: 0, totalValue: 0 },
          monthly: { coins: 0, giftsReceived: 0, totalValue: 0 },
          allTime: { coins: 0, giftsReceived: 0, totalValue: 0 },
          rank: {
            daily: 0,
            weekly: 0,
            monthly: 0,
            allTime: 0,
          },
          currentStreak: 0,
          longestStreak: 0,
          level: 1,
          levelName: "Bronze",
        },
      });
    }

    const levelNames = {
      1: "Bronze",
      2: "Silver",
      3: "Gold",
      4: "Platinum",
    };

    res.status(200).json({
      success: true,
      data: {
        daily: leaderboard.daily,
        weekly: leaderboard.weekly,
        monthly: leaderboard.monthly,
        allTime: leaderboard.allTime,
        rank: leaderboard.rank,
        currentStreak: leaderboard.currentStreak || 0,
        longestStreak: leaderboard.longestStreak || 0,
        level: leaderboard.level || 1,
        levelName: levelNames[leaderboard.level || 1],
        badges: leaderboard.badges || [],
      },
    });
  } catch (error) {
    console.error("❌ getUserContributionStats error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching contribution stats",
      error: error.message,
    });
  }
};

/**
 * 🏆 GET TOP CONTRIBUTORS FOR A PERIOD
 * Returns limited top 10 for quick display
 */
exports.getTopContributors = async (req, res) => {
  try {
    const { period = "daily" } = req.query;

    if (!["daily", "weekly", "monthly", "allTime"].includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Invalid period",
      });
    }

    const top = await Leaderboard.find()
      .populate("userId", "username profile.avatar")
      .sort({ [`${period}.coins`]: -1 })
      .limit(10)
      .lean();

    const formatted = top.map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId?._id,
      username: entry.userId?.username || "Unknown",
      avatar: entry.userId?.profile?.avatar || null,
      coins: entry[period].coins,
      giftsReceived: entry[period].giftsReceived,
      level: entry.level || 1,
    }));

    res.status(200).json({
      success: true,
      period,
      topContributors: formatted,
    });
  } catch (error) {
    console.error("❌ getTopContributors error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching top contributors",
    });
  }
};

/**
 * 🏆 UPDATE LEADERBOARD (Called after gift transaction)
 * This is called internally when gifts are sent
 * ✅ FIXED: Proper error handling, validation, async rank update
 */
exports.updateLeaderboardOnGift = async (userId, giftPrice) => {
  try {
    // ✅ FIX #1: Validate inputs
    if (!userId || typeof giftPrice !== "number" || giftPrice <= 0) {
      throw new Error("Invalid userId or giftPrice");
    }

    const { now, startOfDay, startOfWeek, startOfMonth } =
      getPeriodBoundaries();

    // ✅ FIX #2: Verify sender exists
    const user = await User.findById(userId).select("username profile.avatar");
    if (!user) {
      throw new Error("Sender user not found");
    }

    // Find or create leaderboard entry
    let leaderboard = await Leaderboard.findOne({ userId });

    if (!leaderboard) {
      leaderboard = new Leaderboard({
        userId,
        username: user.username || "Unknown",
        avatar: user.profile?.avatar || null,
      });
    }

    // ✅ FIX #3: Safe default checks for all periods
    const updatePeriodStats = (periodData, startDate) => {
      const lastUpdated = periodData.lastUpdated
        ? new Date(periodData.lastUpdated)
        : null;

      if (!lastUpdated || lastUpdated < startDate) {
        // New period - reset stats
        return {
          coins: giftPrice,
          giftsReceived: 1,
          totalValue: giftPrice,
          lastUpdated: now,
        };
      } else {
        // Same period - increment stats
        return {
          coins: (periodData.coins || 0) + giftPrice,
          giftsReceived: (periodData.giftsReceived || 0) + 1,
          totalValue: (periodData.totalValue || 0) + giftPrice,
          lastUpdated: now,
        };
      }
    };

    // Update daily, weekly, monthly stats
    leaderboard.daily = updatePeriodStats(leaderboard.daily, startOfDay);
    leaderboard.weekly = updatePeriodStats(leaderboard.weekly, startOfWeek);
    leaderboard.monthly = updatePeriodStats(leaderboard.monthly, startOfMonth);

    // Update all-time stats (no reset)
    leaderboard.allTime.coins = (leaderboard.allTime?.coins || 0) + giftPrice;
    leaderboard.allTime.giftsReceived =
      (leaderboard.allTime?.giftsReceived || 0) + 1;
    leaderboard.allTime.totalValue =
      (leaderboard.allTime?.totalValue || 0) + giftPrice;

    // ✅ FIX #4: Update user streak and trophy stats
    const lastContribution = user.trophy?.lastContributionDate
      ? new Date(user.trophy.lastContributionDate)
      : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = user.trophy?.currentStreak || 0;
    let longestStreak = user.trophy?.longestStreak || 0;
    let totalContributions = (user.trophy?.totalContributions || 0) + 1;
    let totalCoinsEarned = (user.trophy?.totalCoinsEarned || 0) + giftPrice;

    if (!lastContribution) {
      // First contribution
      currentStreak = 1;
    } else {
      const lastContributionDate = new Date(lastContribution);
      lastContributionDate.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastContributionDate.getTime() === today.getTime()) {
        // Already contributed today, don't increase streak
        currentStreak = user.trophy?.currentStreak || 1;
      } else if (lastContributionDate.getTime() === yesterday.getTime()) {
        // Contributed yesterday, continue streak
        currentStreak = (user.trophy?.currentStreak || 0) + 1;
        longestStreak = Math.max(currentStreak, longestStreak);
      } else {
        // Streak broken, reset
        currentStreak = 1;
      }
    }

    // Update user's trophy object
    user.trophy = {
      ...user.trophy,
      currentStreak,
      longestStreak,
      lastContributionDate: now,
      totalContributions,
      totalCoinsEarned,
    };

    // ✅ FIX #5: Calculate user level based on total coins earned (Wafa-style)
    let level = 1;
    if (totalCoinsEarned >= 10000) {
      level = 4; // Platinum
    } else if (totalCoinsEarned >= 5000) {
      level = 3; // Gold
    } else if (totalCoinsEarned >= 2000) {
      level = 2; // Silver
    } else {
      level = 1; // Bronze
    }

    leaderboard.level = level;
    leaderboard.currentStreak = currentStreak;
    leaderboard.longestStreak = longestStreak;
    leaderboard.lastContributionDate = now;

    // Save both documents
    await Promise.all([user.save(), leaderboard.save()]);

    console.log(
      `✅ Trophy updated for user ${userId}: +${giftPrice} coins, Level: ${level}, Streak: ${currentStreak}`
    );

    return leaderboard;
  } catch (error) {
    console.error("❌ updateLeaderboardOnGift error:", error.message);
    throw error;
  }
};

/**
 * 🏆 UPDATE ALL RANKS (SCHEDULED - NOT CALLED AFTER EVERY GIFT)
 * This should be called via cron job, not after every transaction
 * ✅ FIXED: Optimized query structure
 */
exports.updateAllRanks = async () => {
  try {
    console.log("📊 Starting rank update...");

    const periods = ["daily", "weekly", "monthly", "allTime"];

    for (const period of periods) {
      // Fetch and sort in single query
      const sorted = await Leaderboard.find()
        .sort({ [`${period}.coins`]: -1 })
        .select("_id");

      // Batch update ranks
      const bulkOps = sorted.map((doc, index) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { [`rank.${period}`]: index + 1 } },
        },
      }));

      if (bulkOps.length > 0) {
        await Leaderboard.bulkWrite(bulkOps);
        console.log(`✅ Updated ${period} ranks`);
      }
    }

    console.log("✅ All ranks updated successfully");
  } catch (error) {
    console.error("❌ updateAllRanks error:", error.message);
    throw error;
  }
};

/**
 * 🏆 GET USER LEVEL AND ACHIEVEMENTS
 */
exports.getUserLevel = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId).select("trophy");

    if (!user?.trophy) {
      return res.status(200).json({
        success: true,
        data: {
          level: 1,
          levelName: "Bronze",
          totalContributions: 0,
          totalCoinsEarned: 0,
          currentStreak: 0,
          longestStreak: 0,
          nextLevelAt: 2000,
          progress: 0,
          achievements: [],
        },
      });
    }

    const levelMap = {
      1: "Bronze",
      2: "Silver",
      3: "Gold",
      4: "Platinum",
    };

    const thresholds = {
      1: 2000,
      2: 5000,
      3: 10000,
      4: 999999,
    };

    const totalEarned = user.trophy.totalCoinsEarned || 0;

    // Determine current level
    let currentLevel = 1;
    if (totalEarned >= 10000) currentLevel = 4;
    else if (totalEarned >= 5000) currentLevel = 3;
    else if (totalEarned >= 2000) currentLevel = 2;
    else currentLevel = 1;

    const nextLevelThreshold =
      thresholds[currentLevel + 1] || thresholds[currentLevel];
    const progress = Math.min(
      Math.round((totalEarned / nextLevelThreshold) * 100),
      100
    );

    res.status(200).json({
      success: true,
      data: {
        level: currentLevel,
        levelName: levelMap[currentLevel] || "Bronze",
        totalContributions: user.trophy.totalContributions || 0,
        totalCoinsEarned: totalEarned,
        currentStreak: user.trophy.currentStreak || 0,
        longestStreak: user.trophy.longestStreak || 0,
        nextLevelAt: nextLevelThreshold,
        progress,
        achievements: user.trophy.achievements || [],
      },
    });
  } catch (error) {
    console.error("❌ getUserLevel error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching user level",
      error: error.message,
    });
  }
};
