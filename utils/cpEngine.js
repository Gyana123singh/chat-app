const CP = require("../models/cp.model");

const CP_ACTIVE_LIMIT = 8000;

exports.addCP = async ({ userId, amount, source, io }) => {
  try {
    if (!userId || amount <= 0) return;

    let cp = await CP.findOne({ userId });

    if (!cp) {
      cp = await CP.create({ userId });
    }

    cp.dailyCP += amount;
    cp.totalCP += amount;

    // 🔥 CP ACTIVE BADGE
    if (!cp.isActive && cp.totalCP >= CP_ACTIVE_LIMIT) {
      cp.isActive = true;
    }

    await cp.save();

    // 🔴 realtime update
    if (io) {
      io.to(userId.toString()).emit("cp:update", {
        added: amount,
        source,
        dailyCP: cp.dailyCP,
        totalCP: cp.totalCP,
        isActive: cp.isActive,
      });
    }

    return cp;
  } catch (err) {
    console.error("❌ CP Engine:", err.message);
  }
};
