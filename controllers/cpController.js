const CP = require("../models/cp.model");
const User = require("../models/users");

// ✅ GET CP STATUS
exports.getCP = async (req, res) => {
  try {
    const userId = req.user.id;

    let cp = await CP.findOne({ userId });
    if (!cp) cp = await CP.create({ userId });

    res.json({
      success: true,
      dailyCP: cp.dailyCP,
      totalCP: cp.totalCP,
      isActive: cp.isActive,
      progressToCoin: cp.dailyCP % 100,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ CLAIM CP → COINS
exports.claimCP = async (req, res) => {
  try {
    const userId = req.user.id;

    const cp = await CP.findOne({ userId });
    if (!cp) return res.json({ success: false });

    if (cp.dailyCP < 100) {
      return res.json({
        success: false,
        message: "Minimum 100 CP required",
      });
    }

    const maxClaim = Math.min(cp.dailyCP, 5000);
    const coins = Math.floor(maxClaim / 100);

    cp.dailyCP = 0;
    await cp.save();

    await User.findByIdAndUpdate(userId, {
      $inc: { coins },
    });

    res.json({
      success: true,
      coinsAdded: coins,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
