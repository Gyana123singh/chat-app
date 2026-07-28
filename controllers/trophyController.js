const Leaderboard = require("../models/trophyLeaderBoard");
const User = require("../models/users");
const GiftTransaction = require("../models/giftTransaction");
const mongoose = require("mongoose");

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

exports.updateLeaderboardOnGift = async (userId, totalCoinsSpent) => {
  if (!userId || !Number.isFinite(totalCoinsSpent) || totalCoinsSpent <= 0)
    return;

  // 1️⃣ Read previous trophy data FIRST (for streak calc)
  const prevUser = await User.findById(userId).select("trophy");

  // ✅ SAFETY GUARD: If user not found (deleted / DB glitch), stop safely
  if (!prevUser) return;

  // 2️⃣ Increment leaderboard totals atomically
  const inc = {
    "daily.coins": totalCoinsSpent,
    "weekly.coins": totalCoinsSpent,
    "monthly.coins": totalCoinsSpent,
    "allTime.coins": totalCoinsSpent,
    "daily.giftsReceived": 1,
    "weekly.giftsReceived": 1,
    "monthly.giftsReceived": 1,
    "allTime.giftsReceived": 1,
    "daily.totalValue": totalCoinsSpent,
    "weekly.totalValue": totalCoinsSpent,
    "monthly.totalValue": totalCoinsSpent,
    "allTime.totalValue": totalCoinsSpent,
  };

  await Leaderboard.findOneAndUpdate(
    { userId },
    {
      $inc: inc,
      $setOnInsert: { userId },
      $set: { lastContributionDate: new Date() },
    },
    { upsert: true, new: true },
  );

  // 3️⃣ Calculate level from PREVIOUS + new total
  const prevTotal = prevUser?.trophy?.totalCoinsEarned || 0;
  const newTotal = prevTotal + totalCoinsSpent;

  let level = 1;
  if (newTotal >= 10000) level = 4;
  else if (newTotal >= 5000) level = 3;
  else if (newTotal >= 2000) level = 2;

  // 4️⃣ Streak calculation using PREVIOUS date (NOT overwritten)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let last = prevUser?.trophy?.lastContributionDate
    ? new Date(
        prevUser.trophy.lastContributionDate.getFullYear(),
        prevUser.trophy.lastContributionDate.getMonth(),
        prevUser.trophy.lastContributionDate.getDate(),
      )
    : null;

  let currentStreak = prevUser?.trophy?.currentStreak || 0;
  let longestStreak = prevUser?.trophy?.longestStreak || 0;

  if (!last) {
    currentStreak = 1;
  } else {
    const diffDays = Math.round((today - last) / 86400000);
    if (diffDays === 0) {
      // same day → keep streak
    } else if (diffDays === 1) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, currentStreak);

  // 5️⃣ Update User + Leaderboard trophy meta
  await Promise.all([
    User.updateOne(
      { _id: userId },
      {
        $inc: {
          "trophy.totalContributions": 1,
          "trophy.totalCoinsEarned": totalCoinsSpent,
        },
        $set: {
          "trophy.lastContributionDate": now,
          "trophy.currentStreak": currentStreak,
          "trophy.longestStreak": longestStreak,
          "trophy.level": level,
        },
      },
    ),
    Leaderboard.updateOne(
      { userId },
      { $set: { level, currentStreak, longestStreak } },
    ),
  ]);
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
    let userId = req.user?.id;
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      userId = req.query.userId;
    }

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
      100,
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

/**
 * 🏆 GET ROOM CONTRIBUTION - Returns total gift coins spent in a specific room
 */
exports.getRoomContribution = async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ success: false, message: "roomId required" });
    }

    const result = await GiftTransaction.aggregate([
      { $match: { roomIdString: roomId, status: "completed" } },
      { $group: { _id: null, total: { $sum: "$totalCoinsDeducted" } } },
    ]);

    const totalContribution = result[0]?.total || 0;
    return res.json({
      success: true,
      roomId,
      totalContribution,
    });
  } catch (err) {
    console.error("❌ Error getRoomContribution:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
