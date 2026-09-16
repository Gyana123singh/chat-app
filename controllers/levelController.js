const Level = require("../models/level");
const LevelConfig = require("../models/levelConfig");
const {
  PERSONAL_LEVEL_EXP: defaultPersonalExp,
  ROOM_LEVEL_EXP: defaultRoomExp,
  DAILY_PERSONAL_LIMIT: defaultDailyLimit,
} = require("../config/levelTables");
const defaultBadges = require("../config/levelBadges");
const defaultBenefits = require("../config/levelBenefits");

// ===============================
// IN-MEMORY LEVEL CONFIG CACHE
// ===============================
let cachedLevelConfig = null;

async function getLevelConfigCached() {
  if (cachedLevelConfig) return cachedLevelConfig;

  try {
    const configDoc = await LevelConfig.findOne({ key: "default" }).lean();
    if (configDoc) {
      const personalExpTable = configDoc.personal?.expTable
        ? Object.fromEntries(
            configDoc.personal.expTable instanceof Map
              ? configDoc.personal.expTable
              : new Map(Object.entries(configDoc.personal.expTable))
          )
        : defaultPersonalExp;

      const roomExpTable = configDoc.room?.expTable
        ? Object.fromEntries(
            configDoc.room.expTable instanceof Map
              ? configDoc.room.expTable
              : new Map(Object.entries(configDoc.room.expTable))
          )
        : defaultRoomExp;

      const personalBadges = configDoc.personal?.badges
        ? Object.fromEntries(
            configDoc.personal.badges instanceof Map
              ? configDoc.personal.badges
              : new Map(Object.entries(configDoc.personal.badges))
          )
        : defaultBadges;

      const personalBenefits = configDoc.personal?.benefits
        ? Object.fromEntries(
            configDoc.personal.benefits instanceof Map
              ? configDoc.personal.benefits
              : new Map(Object.entries(configDoc.personal.benefits))
          )
        : defaultBenefits.personal;

      const roomBenefits = configDoc.room?.benefits
        ? Object.fromEntries(
            configDoc.room.benefits instanceof Map
              ? configDoc.room.benefits
              : new Map(Object.entries(configDoc.room.benefits))
          )
        : defaultBenefits.room;

      const trophyThresholds = configDoc.trophy?.thresholds
        ? Object.fromEntries(
            configDoc.trophy.thresholds instanceof Map
              ? configDoc.trophy.thresholds
              : new Map(Object.entries(configDoc.trophy.thresholds))
          )
        : { 1: 0, 2: 2000, 3: 5000, 4: 10000 };

      cachedLevelConfig = {
        personal: {
          expPerInterval: configDoc.personal?.expPerInterval ?? 10,
          stayIntervalMinutes: configDoc.personal?.stayIntervalMinutes ?? 5,
          dailyLimit: configDoc.personal?.dailyLimit ?? defaultDailyLimit,
          expTable: personalExpTable,
          badges: personalBadges,
          benefits: personalBenefits,
        },
        room: {
          expPerMicInterval: configDoc.room?.expPerMicInterval ?? 20,
          micIntervalMinutes: configDoc.room?.micIntervalMinutes ?? 10,
          pkWinExp: configDoc.room?.pkWinExp ?? 100,
          pkLoseExp: configDoc.room?.pkLoseExp ?? 20,
          pkDrawExp: configDoc.room?.pkDrawExp ?? 50,
          pkMvpExp: configDoc.room?.pkMvpExp ?? 50,
          expTable: roomExpTable,
          benefits: roomBenefits,
        },
        trophy: {
          thresholds: trophyThresholds,
        },
      };

      return cachedLevelConfig;
    }
  } catch (err) {
    console.error("❌ Error loading LevelConfig from DB, using defaults:", err.message);
  }

  // Fallback defaults
  cachedLevelConfig = {
    personal: {
      expPerInterval: 10,
      stayIntervalMinutes: 5,
      dailyLimit: defaultDailyLimit,
      expTable: defaultPersonalExp,
      badges: defaultBadges,
      benefits: defaultBenefits.personal,
    },
    room: {
      expPerMicInterval: 20,
      micIntervalMinutes: 10,
      pkWinExp: 100,
      pkLoseExp: 20,
      pkDrawExp: 50,
      pkMvpExp: 50,
      expTable: defaultRoomExp,
      benefits: defaultBenefits.room,
    },
    trophy: {
      thresholds: { 1: 0, 2: 2000, 3: 5000, 4: 10000 },
    },
  };

  return cachedLevelConfig;
}

exports.refreshLevelConfigCache = async () => {
  cachedLevelConfig = null;
  return await getLevelConfigCached();
};

exports.getDynamicLevelConfig = async () => {
  return await getLevelConfigCached();
};

// ===============================
// RESET DAILY LIMIT
// ===============================
function resetDaily(level) {
  if (!level.daily.lastReset) {
    level.daily.lastReset = new Date();
    level.daily.personalExpToday = 0;
    return;
  }

  const today = new Date().toDateString();
  const last = new Date(level.daily.lastReset).toDateString();

  if (today !== last) {
    level.daily.personalExpToday = 0;
    level.daily.lastReset = new Date();
  }
}

// ===============================
// BADGE RESOLVER (DYNAMIC)
// ===============================
function getBadge(level, customBadges = null) {
  const badges = customBadges || defaultBadges;
  const keys = Object.keys(badges)
    .map(Number)
    .sort((a, b) => a - b);

  let badge = badges[keys[0]] || "⭐";

  for (const k of keys) {
    if (level >= k) badge = badges[k];
  }

  return badge;
}

exports.getBadge = getBadge;

// ===============================
// LEVEL UP CHECK
// ===============================
function checkLevelUp(levelObj, table) {
  const required = Number(table[levelObj.level]);
  if (!required || isNaN(required)) return false;

  if (levelObj.exp >= required) {
    levelObj.exp -= required; // ✅ carry forward
    levelObj.level += 1;
    return true;
  }

  return false;
}

// ===============================
// ADD PERSONAL EXP (DYNAMIC)
// ===============================
exports.addPersonalExp = async (userId, exp = null, io = null) => {
  try {
    const config = await getLevelConfigCached();
    const expToAdd = typeof exp === "number" ? exp : config.personal.expPerInterval;
    const dailyLimit = config.personal.dailyLimit;

    let level = await Level.findOne({ userId });
    if (!level) {
      try {
        level = await Level.create({ userId });
      } catch (e) {
        level = await Level.findOne({ userId });
      }
    }

    if (!level) {
      throw new Error("Level creation failed");
    }

    resetDaily(level);

    if (level.daily.personalExpToday >= dailyLimit) return;

    const allowed = dailyLimit - level.daily.personalExpToday;
    const finalExp = Math.min(expToAdd, allowed);

    level.personal.exp += finalExp;
    level.daily.personalExpToday += finalExp;

    let leveledUp = false;

    // ✅ allow multiple level ups safely using dynamic expTable
    while (checkLevelUp(level.personal, config.personal.expTable)) {
      leveledUp = true;
    }

    await level.save();

    if (leveledUp && io) {
      io.to(userId.toString()).emit("level:up", {
        type: "personal",
        newLevel: level.personal.level,
        badge: getBadge(level.personal.level, config.personal.badges),
      });
    }
  } catch (err) {
    console.error("❌ addPersonalExp error:", err.message);
  }
};

// ===============================
// ADD ROOM EXP (DYNAMIC)
// ===============================
exports.addRoomExp = async (userId, exp = null, io = null) => {
  try {
    const config = await getLevelConfigCached();
    const expToAdd = typeof exp === "number" ? exp : config.room.expPerMicInterval;

    let level = await Level.findOne({ userId });
    if (!level) {
      try {
        level = await Level.create({ userId });
      } catch (e) {
        level = await Level.findOne({ userId });
      }
    }

    if (!level) {
      throw new Error("Level creation failed");
    }

    level.room.exp += expToAdd;

    let leveledUp = false;

    while (checkLevelUp(level.room, config.room.expTable)) {
      leveledUp = true;
    }

    await level.save();

    if (leveledUp && io) {
      io.to(userId.toString()).emit("level:up", {
        type: "room",
        newLevel: level.room.level,
        badge: "🎤",
      });
    }
  } catch (err) {
    console.error("❌ addRoomExp error:", err.message);
  }
};

// ===============================
// GET USER LEVEL (DYNAMIC)
// ===============================
exports.getUserLevel = async (req, res) => {
  try {
    const userId = req.user.id;
    const config = await getLevelConfigCached();

    let level = await Level.findOne({ userId });
    if (!level) {
      try {
        level = await Level.create({ userId });
      } catch (e) {
        level = await Level.findOne({ userId });
      }
    }

    if (!level) {
      return res.status(500).json({
        success: false,
        message: "Level creation failed",
      });
    }

    const personalReq = config.personal.expTable[level.personal.level];
    const roomReq = config.room.expTable[level.room.level];

    res.json({
      success: true,
      personal: {
        level: level.personal.level,
        exp: level.personal.exp,
        requiredExp: personalReq !== undefined ? Number(personalReq) : "MAX",
        badge: getBadge(level.personal.level, config.personal.badges),
        benefits: config.personal.benefits[level.personal.level] || {},
      },
      room: {
        level: level.room.level,
        exp: level.room.exp,
        requiredExp: roomReq !== undefined ? Number(roomReq) : "MAX",
        benefits: config.room.benefits[level.room.level] || {},
      },
    });
  } catch (err) {
    console.error("❌ getUserLevel error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch level data",
    });
  }
};

// ===============================
// MONTHLY SESSION LEVEL RESET
// ===============================
exports.resetAllLevelsForNewSession = async () => {
  try {
    const Level = require("../models/level");
    const User = require("../models/users");

    console.log("🧹 [LEVEL RESET] Resetting all User & Room levels to 0 for new monthly session...");

    // Reset Level documents
    await Level.updateMany({}, {
      $set: {
        "personal.level": 1,
        "personal.exp": 0,
        "room.level": 0,
        "room.exp": 0,
        "daily.personalExpToday": 0,
        "daily.lastReset": new Date(),
      }
    });

    // Reset User cached level fields
    await User.updateMany({}, {
      $set: {
        "level.personal.level": 1,
        "level.personal.exp": 0,
        "level.room.level": 1,
        "level.room.exp": 0,
      }
    });

    console.log("✅ [LEVEL RESET] All levels successfully reset for new session!");
    return { success: true };
  } catch (err) {
    console.error("❌ [LEVEL RESET] Error resetting levels:", err.message);
    throw err;
  }
};

