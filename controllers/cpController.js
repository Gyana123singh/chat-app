const CP = require("../models/cp.model");
const User = require("../models/users");
const CPHistory = require("../models/cpHistory.model");

/* =========================
   GET CP STATUS
========================= */
exports.getCP = async (req, res) => {
  try {
    const userId = req.user.id;

    let cp = await CP.findOne({ userId });

    if (!cp) {
      cp = await CP.create({ userId });
    }
    const now = new Date();
    const last = new Date(cp.lastReset);

    if (
      now.getDate() !== last.getDate() ||
      now.getMonth() !== last.getMonth() ||
      now.getFullYear() !== last.getFullYear()
    ) {
      cp.dailyCP = 0;
      cp.lastReset = now;
      await cp.save();
    }

    return res.json({
      success: true,
      dailyCP: cp.dailyCP,
      totalCP: cp.totalCP,
      isActive: cp.isActive,
      progressToCoin: cp.dailyCP % 100,
    });
  } catch (error) {
    console.error("❌ getCP error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch CP status",
    });
  }
};

/* =========================
   CLAIM CP → COINS
========================= */
exports.claimCP = async (req, res) => {
  try {
    const userId = req.user.id;

    const cp = await CP.findOne({ userId });

    if (!cp) {
      return res.json({
        success: false,
        message: "CP record not found",
      });
    }

    if (cp.dailyCP < 100) {
      return res.json({
        success: false,
        message: "Minimum 100 CP required",
      });
    }

    // 🔥 WAFA LOGIC
    const maxClaimCP = Math.min(cp.dailyCP, 5000);
    const coins = Math.floor(maxClaimCP / 100);
    const usedCP = coins * 100;
    cp.dailyCP -= usedCP;
    await cp.save();

    await User.findByIdAndUpdate(userId, {
      $inc: { coins },
    });
    await CPHistory.create({
      userId,
      amount: -usedCP,
      source: "CLAIM",
    });

    return res.json({
      success: true,
      coinsAdded: coins,
      remainingCP: cp.dailyCP,
    });
  } catch (error) {
    console.error("❌ claimCP error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to claim CP",
    });
  }
};

/* =========================
   CP HISTORY
========================= */
exports.getCPHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const history = await CPHistory.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100);

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("❌ getCPHistory error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch CP history",
    });
  }
};
