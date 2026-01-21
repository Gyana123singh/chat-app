const Level = require("../models/level");
const User = require("../models/users");

// Level thresholds (EXP needed for each level)
const PERSONAL_LEVEL_THRESHOLDS = {
  1: 0,
  2: 700,
  3: 1500,
  4: 2500,
  5: 3800,
  6: 5200,
  7: 6700,
  8: 8300,
  9: 10000,
  10: 12000,
  11: 14200,
  12: 16600,
  13: 19200,
  14: 22000,
  15: 25000,
};

const ROOM_LEVEL_THRESHOLDS = {
  1: 0,
  2: 500,
  3: 1100,
  4: 1800,
  5: 2600,
  6: 3500,
  7: 4500,
  8: 5600,
  9: 6800,
  10: 8100,
};

// Level benefits configuration
const LEVEL_BENEFITS = {
  1: {
    benefitId: "headwear_1",
    benefitName: "Headwear",
    level: 1,
    description: "Unlock headwear customization",
    icon: "👑",
  },
  2: {
    benefitId: "create_room",
    benefitName: "Create a room",
    level: 2,
    description: "Create and host your own room",
    icon: "🏠",
  },
  5: {
    benefitId: "unlimited_photo",
    benefitName: "Unlimited photo",
    level: 5,
    description: "Upload unlimited profile photos",
    icon: "📸",
  },
};

/**
 * ⬆️ GET USER LEVEL AND PROGRESS
 * Returns current level, EXP, and progress bar data
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

    let level = await Level.findOne({ userId });

    if (!level) {
      // Create initial level record
      level = new Level({ userId });
      await level.save();
    }

    const personalLevel = level.personal;
    const roomLevel = level.room;

    // Get next level threshold
    const nextPersonalThreshold =
      PERSONAL_LEVEL_THRESHOLDS[personalLevel.currentLevel + 1] ||
      PERSONAL_LEVEL_THRESHOLDS;
    const nextRoomThreshold =
      ROOM_LEVEL_THRESHOLDS[roomLevel.currentLevel + 1] ||
      ROOM_LEVEL_THRESHOLDS;

    // Calculate progress
    const currentThreshold =
      PERSONAL_LEVEL_THRESHOLDS[personalLevel.currentLevel];
    const personalProgress = Math.round(
      ((personalLevel.totalExp - currentThreshold) /
        (nextPersonalThreshold - currentThreshold)) *
        100,
    );

    const currentRoomThreshold = ROOM_LEVEL_THRESHOLDS[roomLevel.currentLevel];
    const roomProgress = Math.round(
      ((roomLevel.totalExp - currentRoomThreshold) /
        (nextRoomThreshold - currentRoomThreshold)) *
        100,
    );

    res.status(200).json({
      success: true,
      data: {
        personal: {
          currentLevel: personalLevel.currentLevel,
          currentExp: personalLevel.currentExp,
          totalExp: personalLevel.totalExp,
          expToNextLevel: nextPersonalThreshold - personalLevel.totalExp,
          nextLevel: personalLevel.currentLevel + 1,
          progress: personalProgress,
          progressBar: `${personalLevel.currentExp}/${
            nextPersonalThreshold - currentThreshold
          }`,
        },
        room: {
          currentLevel: roomLevel.currentLevel,
          currentExp: roomLevel.currentExp,
          totalExp: roomLevel.totalExp,
          expToNextLevel: nextRoomThreshold - roomLevel.totalExp,
          nextLevel: roomLevel.currentLevel + 1,
          progress: roomProgress,
          progressBar: `${roomLevel.currentExp}/${
            nextRoomThreshold - currentRoomThreshold
          }`,
        },
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
 * ⬆️ GET LEVEL BENEFITS
 * Returns all available benefits and which ones user has unlocked
 */
exports.getLevelBenefits = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
      await level.save();
    }

    const userLevel = level.personal.currentLevel;

    // Build benefits response
    const benefits = Object.entries(LEVEL_BENEFITS).map(
      ([requiredLevel, benefit]) => ({
        ...benefit,
        isUnlocked: userLevel >= requiredLevel,
        requiredLevel,
      }),
    );

    res.status(200).json({
      success: true,
      currentLevel: userLevel,
      benefits: benefits.sort((a, b) => a.level - b.level),
    });
  } catch (error) {
    console.error("❌ getLevelBenefits error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching level benefits",
    });
  }
};

/**
 * ⬆️ GET WAYS TO LEVEL UP
 * Shows all activities that give EXP and daily progress
 */
exports.getWaysToLevelUp = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
      await level.save();
    }

    // Check if daily counters need reset
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastReset = new Date(
      level.expSources.playLudo.lastReset.getFullYear(),
      level.expSources.playLudo.lastReset.getMonth(),
      level.expSources.playLudo.lastReset.getDate(),
    );

    if (today.getTime() > lastReset.getTime()) {
      // Reset daily limits
      level.expSources.playLudo.count = 0;
      level.expSources.playLudo.lastReset = now;
      level.expSources.stayInRoom.count = 0;
      level.expSources.stayInRoom.lastReset = now;
      await level.save();
    }

    const waysToLevelUp = [
      {
        activityName: "Play Ludo",
        description: "1 round/10 EXP",
        expPerActivity: 10,
        dailyLimit: level.expSources.playLudo.dailyLimit,
        currentProgress: level.expSources.playLudo.count,
        dailyExpEarned: level.expSources.playLudo.totalExp,
        canEarnMore:
          level.expSources.playLudo.count <
          level.expSources.playLudo.dailyLimit,
        remaining:
          level.expSources.playLudo.dailyLimit -
          level.expSources.playLudo.count,
      },
      {
        activityName: "Stay in Room",
        description: "5 mins/10 EXP",
        expPerActivity: 10,
        dailyLimit: level.expSources.stayInRoom.dailyLimit,
        currentProgress: level.expSources.stayInRoom.count,
        dailyExpEarned: level.expSources.stayInRoom.totalExp,
        canEarnMore:
          level.expSources.stayInRoom.count <
          level.expSources.stayInRoom.dailyLimit,
        remaining:
          level.expSources.stayInRoom.dailyLimit -
          level.expSources.stayInRoom.count,
      },
      {
        activityName: "Send gift",
        description: "25 coins/1 EXP (No daily limit)",
        expPerActivity: 1,
        dailyLimit: "∞",
        currentProgress: level.expSources.sendGift.count,
        dailyExpEarned: level.expSources.sendGift.totalExp,
        canEarnMore: true,
      },
      {
        activityName: "Buy Store goods",
        description: "25 coins/1 EXP (No daily limit)",
        expPerActivity: 1,
        dailyLimit: "∞",
        currentProgress: level.expSources.buyStoreGoods.count,
        dailyExpEarned: level.expSources.buyStoreGoods.totalExp,
        canEarnMore: true,
      },
    ];

    res.status(200).json({
      success: true,
      waysToLevelUp,
    });
  } catch (error) {
    console.error("❌ getWaysToLevelUp error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching ways to level up",
    });
  }
};

/**
 * ⬆️ ADD EXP - PLAY LUDO
 * Called after completing a Ludo game
 */
exports.addExpPlayLudo = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { roomId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
    }

    // Check daily limit
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastReset = new Date(
      level.expSources.playLudo.lastReset.getFullYear(),
      level.expSources.playLudo.lastReset.getMonth(),
      level.expSources.playLudo.lastReset.getDate(),
    );

    if (today.getTime() > lastReset.getTime()) {
      level.expSources.playLudo.count = 0;
      level.expSources.playLudo.totalExp = 0;
      level.expSources.playLudo.lastReset = now;
    }

    if (
      level.expSources.playLudo.count >= level.expSources.playLudo.dailyLimit
    ) {
      return res.status(400).json({
        success: false,
        message: "Daily Ludo EXP limit reached",
        remaining: 0,
      });
    }

    // Add EXP
    const expToAdd = level.expSources.playLudo.dailyExp;
    await exports.addExperience(userId, expToAdd, "personal");

    // Update counter
    level.expSources.playLudo.count += 1;
    level.expSources.playLudo.totalExp += expToAdd;
    level.expSources.playLudo.lastUpdate = now;
    await level.save();

    res.status(200).json({
      success: true,
      message: `+${expToAdd} EXP from Ludo`,
      expAdded: expToAdd,
      newTotal: level.personal.totalExp,
      dailyRemaining:
        level.expSources.playLudo.dailyLimit - level.expSources.playLudo.count,
    });
  } catch (error) {
    console.error("❌ addExpPlayLudo error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error adding EXP",
      error: error.message,
    });
  }
};

/**
 * ⬆️ ADD EXP - STAY IN ROOM
 * Called periodically (every 5 minutes) while user is in a room
 */
exports.addExpStayInRoom = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { roomId, duration } = req.body; // duration in minutes

    if (!userId || !roomId || !duration) {
      return res.status(400).json({
        success: false,
        message: "Missing userId, roomId, or duration",
      });
    }

    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
    }

    // Check daily limit
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastReset = new Date(
      level.expSources.stayInRoom.lastReset.getFullYear(),
      level.expSources.stayInRoom.lastReset.getMonth(),
      level.expSources.stayInRoom.lastReset.getDate(),
    );

    if (today.getTime() > lastReset.getTime()) {
      level.expSources.stayInRoom.count = 0;
      level.expSources.stayInRoom.totalExp = 0;
      level.expSources.stayInRoom.lastReset = now;
    }

    // Calculate EXP based on duration
    const numRewards = Math.floor(
      duration / level.expSources.stayInRoom.minPerReward,
    );
    const expToAdd = numRewards * level.expSources.stayInRoom.expPerReward;

    // Check if within daily limit
    const newTotal = level.expSources.stayInRoom.count + numRewards;
    if (newTotal > level.expSources.stayInRoom.dailyLimit) {
      const allowedRewards =
        level.expSources.stayInRoom.dailyLimit -
        level.expSources.stayInRoom.count;
      const allowedExp = allowedRewards * 10;

      if (allowedExp <= 0) {
        return res.status(400).json({
          success: false,
          message: "Daily room EXP limit reached",
          remaining: 0,
        });
      }

      // Add only allowed EXP
      await exports.addExperience(userId, allowedExp, "personal");
      level.expSources.stayInRoom.count =
        level.expSources.stayInRoom.dailyLimit;
      level.expSources.stayInRoom.totalExp += allowedExp;
      level.expSources.stayInRoom.roomDurations.push({
        roomId,
        duration,
        expEarned: allowedExp,
        date: now,
      });
      await level.save();

      return res.status(200).json({
        success: true,
        message: `+${allowedExp} EXP from room (daily limit reached)`,
        expAdded: allowedExp,
        newTotal: level.personal.totalExp,
        dailyRemaining: 0,
      });
    }

    // Add EXP
    await exports.addExperience(userId, expToAdd, "personal");

    level.expSources.stayInRoom.count += numRewards;
    level.expSources.stayInRoom.totalExp += expToAdd;
    level.expSources.stayInRoom.roomDurations.push({
      roomId,
      duration,
      expEarned: expToAdd,
      date: now,
    });
    await level.save();

    res.status(200).json({
      success: true,
      message: `+${expToAdd} EXP from room stay`,
      expAdded: expToAdd,
      newTotal: level.personal.totalExp,
      dailyRemaining:
        level.expSources.stayInRoom.dailyLimit -
        level.expSources.stayInRoom.count,
    });
  } catch (error) {
    console.error("❌ addExpStayInRoom error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error adding EXP",
      error: error.message,
    });
  }
};

/**
 * ⬆️ ADD EXP - SEND GIFT
 * Called after sending a gift (no daily limit)
 */
exports.addExpSendGift = async (userId, giftPrice) => {
  try {
    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
    }

    // Calculate EXP based on gift price
    const expToAdd = Math.floor(giftPrice / 25); // 25 coins = 1 EXP

    if (expToAdd > 0) {
      await exports.addExperience(userId, expToAdd, "personal");

      level.expSources.sendGift.count += 1;
      level.expSources.sendGift.totalExp += expToAdd;
      level.expSources.sendGift.lastUpdate = new Date();
      await level.save();
    }

    return expToAdd;
  } catch (error) {
    console.error("❌ addExpSendGift error:", error.message);
    throw error;
  }
};

/**
 * ⬆️ ADD EXP - BUY STORE GOODS
 * Called after purchasing store items (no daily limit)
 */
exports.addExpBuyStoreGoods = async (userId, coinsSpent) => {
  try {
    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
    }

    // Calculate EXP based on coins spent
    const expToAdd = Math.floor(coinsSpent / 25); // 25 coins = 1 EXP

    if (expToAdd > 0) {
      await exports.addExperience(userId, expToAdd, "personal");

      level.expSources.buyStoreGoods.count += 1;
      level.expSources.buyStoreGoods.totalExp += expToAdd;
      level.expSources.buyStoreGoods.lastUpdate = new Date();
      await level.save();
    }

    return expToAdd;
  } catch (error) {
    console.error("❌ addExpBuyStoreGoods error:", error.message);
    throw error;
  }
};

/**
 * ⬆️ INTERNAL: Add Experience and Check Level Up
 * @param {string} userId - User ID
 * @param {number} expAmount - EXP to add
 * @param {string} type - "personal" or "room"
 */
exports.addExperience = async (userId, expAmount, type = "personal") => {
  try {
    let level = await Level.findOne({ userId });

    if (!level) {
      level = new Level({ userId });
    }

    const thresholds =
      type === "personal" ? PERSONAL_LEVEL_THRESHOLDS : ROOM_LEVEL_THRESHOLDS;
    const maxLevel = Math.max(...Object.keys(thresholds).map(Number));

    // Add EXP
    level[type].currentExp += expAmount;
    level[type].totalExp += expAmount;
    level[type].lastUpdated = new Date();

    // Check for level up
    let leveledUp = false;
    let levelUpCount = 0;

    while (
      level[type].totalExp >= thresholds[level[type].currentLevel + 1] &&
      level[type].currentLevel < maxLevel
    ) {
      level[type].currentLevel += 1;
      level[type].currentExp = 0; // Reset progress bar
      leveledUp = true;
      levelUpCount += 1;

      // Grant level up rewards
      const reward = {
        level: level[type].currentLevel,
        reward: `Level ${level[type].currentLevel} reached!`,
        rewardType: "levelUp",
        rewardValue: level[type].currentLevel * 100, // Coins reward
        claimed: false,
      };
      level.levelUpRewards.push(reward);
    }

    // Reset current EXP to show progress for current level
    if (level[type].currentLevel > 1) {
      const currentThreshold = thresholds[level[type].currentLevel];
      level[type].currentExp = level[type].totalExp - currentThreshold;
    }

    await level.save();

    // Update user model
    const user = await User.findById(userId);
    if (user) {
      user.level = {
        personal: {
          level: level.personal.currentLevel,
          exp: level.personal.currentExp,
        },
        room: {
          level: level.room.currentLevel,
          exp: level.room.currentExp,
        },
      };
      await user.save();
    }

    return {
      leveledUp,
      levelUpCount,
      newLevel: level[type].currentLevel,
      newExp: level[type].currentExp,
    };
  } catch (error) {
    console.error("❌ addExperience error:", error.message);
    throw error;
  }
};

/**
 * ⬆️ GET LEVEL UP REWARDS
 * Returns unclaimed rewards for user
 */
exports.getLevelUpRewards = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const level = await Level.findOne({ userId });

    if (!level) {
      return res.status(200).json({
        success: true,
        rewards: [],
      });
    }

    const unclaimedRewards = level.levelUpRewards.filter((r) => !r.claimed);

    res.status(200).json({
      success: true,
      rewards: unclaimedRewards,
    });
  } catch (error) {
    console.error("❌ getLevelUpRewards error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching rewards",
    });
  }
};

/**
 * ⬆️ CLAIM LEVEL UP REWARD
 */
exports.claimLevelUpReward = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { rewardIndex } = req.body;

    if (!userId || rewardIndex === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing userId or rewardIndex",
      });
    }

    const level = await Level.findOne({ userId });

    if (!level) {
      return res.status(404).json({
        success: false,
        message: "Level record not found",
      });
    }

    const reward = level.levelUpRewards[rewardIndex];

    if (!reward) {
      return res.status(404).json({
        success: false,
        message: "Reward not found",
      });
    }

    if (reward.claimed) {
      return res.status(400).json({
        success: false,
        message: "Reward already claimed",
      });
    }

    // Mark as claimed
    reward.claimed = true;
    reward.claimedAt = new Date();

    // Grant reward to user
    const user = await User.findById(userId);
    if (user && reward.rewardType === "levelUp") {
      user.coins = (user.coins || 0) + reward.rewardValue;
      await user.save();
    }

    await level.save();

    res.status(200).json({
      success: true,
      message: "Reward claimed successfully",
      reward,
      userCoins: user.coins,
    });
  } catch (error) {
    console.error("❌ claimLevelUpReward error:", error.message);
    res.status(500).json({
      success: false,
      message: "Error claiming reward",
    });
  }
};

