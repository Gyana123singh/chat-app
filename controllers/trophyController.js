const Leaderboard = require("../models/trophyLeaderBoard");
const User = require("../models/users");
const GiftTransaction = require("../models/giftTransaction");

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
          level: 1,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        daily: leaderboard.daily,
        weekly: leaderboard.weekly,
        monthly: leaderboard.monthly,
        allTime: leaderboard.allTime,
        rank: leaderboard.rank,
        currentStreak: leaderboard.currentStreak || 0,
        level: leaderboard.level || 1,
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
      .populate("userId", "username profile.avatar stats")
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
 */
exports.updateLeaderboardOnGift = async (userId, giftPrice) => {
  try {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Find or create leaderboard entry
    let leaderboard = await Leaderboard.findOne({ userId });

    if (!leaderboard) {
      const user = await User.findById(userId).select(
        "username profile.avatar"
      );
      leaderboard = new Leaderboard({
        userId,
        username: user?.username || "Unknown",
        avatar: user?.profile?.avatar || null,
      });
    }

    // Update daily stats
    if (
      !leaderboard.daily.lastUpdated ||
      new Date(leaderboard.daily.lastUpdated) < startOfDay
    ) {
      leaderboard.daily = {
        coins: giftPrice,
        giftsReceived: 1,
        totalValue: giftPrice,
        lastUpdated: now,
      };
    } else {
      leaderboard.daily.coins += giftPrice;
      leaderboard.daily.giftsReceived += 1;
      leaderboard.daily.totalValue += giftPrice;
      leaderboard.daily.lastUpdated = now;
    }

    // Update weekly stats
    if (
      !leaderboard.weekly.lastUpdated ||
      new Date(leaderboard.weekly.lastUpdated) < startOfWeek
    ) {
      leaderboard.weekly = {
        coins: giftPrice,
        giftsReceived: 1,
        totalValue: giftPrice,
        lastUpdated: now,
      };
    } else {
      leaderboard.weekly.coins += giftPrice;
      leaderboard.weekly.giftsReceived += 1;
      leaderboard.weekly.totalValue += giftPrice;
      leaderboard.weekly.lastUpdated = now;
    }

    // Update monthly stats
    if (
      !leaderboard.monthly.lastUpdated ||
      new Date(leaderboard.monthly.lastUpdated) < startOfMonth
    ) {
      leaderboard.monthly = {
        coins: giftPrice,
        giftsReceived: 1,
        totalValue: giftPrice,
        lastUpdated: now,
      };
    } else {
      leaderboard.monthly.coins += giftPrice;
      leaderboard.monthly.giftsReceived += 1;
      leaderboard.monthly.totalValue += giftPrice;
      leaderboard.monthly.lastUpdated = now;
    }

    // Update all-time stats
    leaderboard.allTime.coins += giftPrice;
    leaderboard.allTime.giftsReceived += 1;
    leaderboard.allTime.totalValue += giftPrice;

    // Update user streak
    const user = await User.findById(userId);
    if (user) {
      const lastContribution = user.trophy?.lastContributionDate;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (!lastContribution) {
        // First contribution
        user.trophy = {
          ...user.trophy,
          currentStreak: 1,
          lastContributionDate: now,
          totalContributions: (user.trophy?.totalContributions || 0) + 1,
          totalCoinsEarned: (user.trophy?.totalCoinsEarned || 0) + giftPrice,
        };
      } else {
        const lastContributionDate = new Date(lastContribution);
        lastContributionDate.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastContributionDate.getTime() === today.getTime()) {
          // Already contributed today, don't increase streak
        } else if (lastContributionDate.getTime() === yesterday.getTime()) {
          // Contributed yesterday, continue streak
          user.trophy = {
            ...user.trophy,
            currentStreak: (user.trophy?.currentStreak || 0) + 1,
            lastContributionDate: now,
            totalContributions: (user.trophy?.totalContributions || 0) + 1,
            totalCoinsEarned: (user.trophy?.totalCoinsEarned || 0) + giftPrice,
          };

          // Update longest streak if needed
          if (
            (user.trophy?.currentStreak || 0) >
            (user.trophy?.longestStreak || 0)
          ) {
            user.trophy.longestStreak = user.trophy.currentStreak;
          }
        } else {
          // Streak broken, reset
          user.trophy = {
            ...user.trophy,
            currentStreak: 1,
            lastContributionDate: now,
            totalContributions: (user.trophy?.totalContributions || 0) + 1,
            totalCoinsEarned: (user.trophy?.totalCoinsEarned || 0) + giftPrice,
          };
        }
      }

      // Calculate user level based on total coins earned
      const totalEarned = user.trophy?.totalCoinsEarned || 0;
      if (totalEarned >= 10000) {
        leaderboard.level = 4; // Platinum
      } else if (totalEarned >= 5000) {
        leaderboard.level = 3; // Gold
      } else if (totalEarned >= 2000) {
        leaderboard.level = 2; // Silver
      } else {
        leaderboard.level = 1; // Bronze
      }

      await user.save();
    }

    // Save leaderboard
    await leaderboard.save();

    // Update ranks asynchronously (don't wait for it)
    exports
      .updateAllRanks()
      .catch((err) => console.error("Error updating ranks:", err));

    return leaderboard;
  } catch (error) {
    console.error("❌ updateLeaderboardOnGift error:", error.message);
    throw error;
  }
};

/**
 * 🏆 UPDATE ALL RANKS
 * Recalculates all user ranks (expensive operation, should be scheduled)
 */
exports.updateAllRanks = async () => {
  try {
    const now = new Date();

    // Update daily ranks
    const dailyLeaderboard = await Leaderboard.find()
      .sort({ "daily.coins": -1 })
      .select("_id");

    for (let i = 0; i < dailyLeaderboard.length; i++) {
      await Leaderboard.findByIdAndUpdate(dailyLeaderboard[i]._id, {
        "rank.daily": i + 1,
      });
    }

    // Update weekly ranks
    const weeklyLeaderboard = await Leaderboard.find()
      .sort({ "weekly.coins": -1 })
      .select("_id");

    for (let i = 0; i < weeklyLeaderboard.length; i++) {
      await Leaderboard.findByIdAndUpdate(weeklyLeaderboard[i]._id, {
        "rank.weekly": i + 1,
      });
    }

    // Update monthly ranks
    const monthlyLeaderboard = await Leaderboard.find()
      .sort({ "monthly.coins": -1 })
      .select("_id");

    for (let i = 0; i < monthlyLeaderboard.length; i++) {
      await Leaderboard.findByIdAndUpdate(monthlyLeaderboard[i]._id, {
        "rank.monthly": i + 1,
      });
    }

    // Update all-time ranks
    const allTimeLeaderboard = await Leaderboard.find()
      .sort({ "allTime.coins": -1 })
      .select("_id");

    for (let i = 0; i < allTimeLeaderboard.length; i++) {
      await Leaderboard.findByIdAndUpdate(allTimeLeaderboard[i]._id, {
        "rank.allTime": i + 1,
      });
    }

    console.log("✅ All ranks updated");
  } catch (error) {
    console.error("❌ updateAllRanks error:", error.message);
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

    const level = user.trophy.level || 1;
    const totalEarned = user.trophy.totalCoinsEarned || 0;

    let nextLevelAt = 2000;
    if (level === 1) nextLevelAt = 2000;
    else if (level === 2) nextLevelAt = 5000;
    else if (level === 3) nextLevelAt = 10000;
    else nextLevelAt = 999999; // Platinum max

    const progress = Math.round((totalEarned / nextLevelAt) * 100);

    res.status(200).json({
      success: true,
      data: {
        level,
        levelName: levelMap[level] || "Bronze",
        totalContributions: user.trophy.totalContributions || 0,
        totalCoinsEarned: totalEarned,
        currentStreak: user.trophy.currentStreak || 0,
        longestStreak: user.trophy.longestStreak || 0,
        nextLevelAt: Math.min(nextLevelAt, 999999),
        progress: Math.min(progress, 100),
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
