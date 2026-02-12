const Level = require("../models/level");
const {
  PERSONAL_LEVEL_EXP,
  ROOM_LEVEL_EXP,
  DAILY_PERSONAL_LIMIT,
} = require("../config/levelTables");

const levelBadges = require("../config/levelBadges");
const levelBenefits = require("../config/levelBenefits");

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
// BADGE RESOLVER (WAFA STYLE)
// ===============================
function getBadge(level) {
  const keys = Object.keys(levelBadges)
    .map(Number)
    .sort((a, b) => a - b);

  let badge = levelBadges[keys[0]];

  for (const k of keys) {
    if (level >= k) badge = levelBadges[k];
  }

  return badge;
}

// ===============================
// LEVEL UP CHECK
// ===============================
function checkLevelUp(levelObj, table) {
  const required = table[levelObj.level];
  if (!required) return false;

  if (levelObj.exp >= required) {
    levelObj.exp -= required; // ✅ carry forward
    levelObj.level += 1;
    return true;
  }

  return false;
}

// ===============================
// ADD PERSONAL EXP
// ===============================
exports.addPersonalExp = async (userId, exp, io = null) => {
  try {
    let level = await Level.findOne({ userId });
    if (!level) {
      try {
        level = await Level.create({ userId });
      } catch (e) {
        // In case two requests created it at same time
        level = await Level.findOne({ userId });
      }
    }

    if (!level) {
      throw new Error("Level creation failed");
    }

    resetDaily(level);

    if (level.daily.personalExpToday >= DAILY_PERSONAL_LIMIT) return;

    const allowed = DAILY_PERSONAL_LIMIT - level.daily.personalExpToday;
    const finalExp = Math.min(exp, allowed);

    level.personal.exp += finalExp;
    level.daily.personalExpToday += finalExp;

    let leveledUp = false;

    // ✅ allow multiple level ups safely
    while (checkLevelUp(level.personal, PERSONAL_LEVEL_EXP)) {
      leveledUp = true;
    }

    await level.save();

    if (leveledUp && io) {
      io.to(userId.toString()).emit("level:up", {
        type: "personal",
        newLevel: level.personal.level,
        badge: getBadge(level.personal.level),
      });
    }
  } catch (err) {
    console.error("❌ addPersonalExp error:", err.message);
    // swallow error so sockets/timers don't crash the server
  }
};

// ===============================
// ADD ROOM EXP
// ===============================
exports.addRoomExp = async (userId, exp, io = null) => {
  try {
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

    level.room.exp += exp;

    let leveledUp = false;

    while (checkLevelUp(level.room, ROOM_LEVEL_EXP)) {
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
// GET USER LEVEL
// ===============================
exports.getUserLevel = async (req, res) => {
  try {
    const userId = req.user.id;

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

    res.json({
      success: true,
      personal: {
        level: level.personal.level,
        exp: level.personal.exp,
        requiredExp: PERSONAL_LEVEL_EXP[level.personal.level] || "MAX",
        badge: getBadge(level.personal.level),
        benefits: levelBenefits.personal[level.personal.level] || {},
      },
      room: {
        level: level.room.level,
        exp: level.room.exp,
        requiredExp: ROOM_LEVEL_EXP[level.room.level] || "MAX",
        benefits: levelBenefits.room[level.room.level] || {},
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
