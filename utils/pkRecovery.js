const PKBattle = require("../models/pkBattle");
const { schedulePKEnd } = require("../utils/pkScheduler");

async function recoverRunningPKs() {
  const runningPKs = await PKBattle.find({ status: "running" });

  for (const pk of runningPKs) {
    const elapsed = Date.now() - new Date(pk.startedAt).getTime();

    const remaining = pk.duration * 1000 - elapsed;

    if (remaining <= 0) {
      // 🔥 End immediately but async-safe
      schedulePKEnd(pk._id, 1);
    } else {
      schedulePKEnd(pk._id, remaining / 1000);
    }
  }
}

module.exports = { recoverRunningPKs };
