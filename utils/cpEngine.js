const CP = require("../models/cp.model");
const User = require("../models/users");
const CPHistory = require("../models/cpHistory.model");

const CP_ACTIVE_LIMIT = 8000;

exports.addCP = async ({ userId, amount, source, io }) => {
  try {
    if (!userId || amount <= 0) return;

    let cp = await CP.findOne({ userId });
    if (!cp) cp = await CP.create({ userId });

    const now = new Date();
    const last = new Date(cp.lastReset);

    // 🔥 DAILY RESET
    if (
      now.getDate() !== last.getDate() ||
      now.getMonth() !== last.getMonth() ||
      now.getFullYear() !== last.getFullYear()
    ) {
      cp.dailyCP = 0;
      cp.lastReset = now;
    }

    // 🔒 DAILY LIMIT
    if (cp.dailyCP >= cp.dailyLimit) return;

    const allowedAdd = Math.min(amount, cp.dailyLimit - cp.dailyCP);

    cp.dailyCP += allowedAdd;
    cp.totalCP += allowedAdd;

    // 🔥 CP ACTIVE BADGE
    if (!cp.isActive && cp.totalCP >= CP_ACTIVE_LIMIT) {
      cp.isActive = true;

      await User.findByIdAndUpdate(userId, {
        "profile.badge": "cp_active",
      });
    }

    await cp.save();

    // 🧾 HISTORY LOG
    await CPHistory.create({
      userId,
      amount: allowedAdd,
      source,
    });

    // 🔴 REALTIME SOCKET
    io?.to(userId.toString()).emit("cp:update", {
      added: allowedAdd,
      source,
      dailyCP: cp.dailyCP,
      totalCP: cp.totalCP,
      isActive: cp.isActive,
    });

    return cp;
  } catch (err) {
    console.error("❌ CP Engine:", err.message);
  }
};
