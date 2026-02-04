const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");
const { getIO } = require("../utils/socketService");

const activeTimers = new Map();

function clearPKTimer(pkId) {
  const key = pkId.toString();
  if (activeTimers.has(key)) {
    clearTimeout(activeTimers.get(key));
    activeTimers.delete(key);
  }
}

function schedulePKEnd(pkId, duration) {
  const key = pkId.toString();

  if (activeTimers.has(key)) return;

  const timer = setTimeout(async () => {
    const pk = await PKBattle.findById(pkId);
    if (!pk || pk.status !== "running") {
      clearPKTimer(pkId);
      return;
    }

    pk.status = "ended";
    pk.endedAt = new Date();

    if (pk.leftUser.score > pk.rightUser.score) {
      pk.winner = pk.leftUser.userId;
    } else if (pk.rightUser.score > pk.leftUser.score) {
      pk.winner = pk.rightUser.userId;
    }

    await pk.save();
    await Room.findOneAndUpdate({ roomId: pk.roomId }, { activePK: null });

    getIO().to(`room:${pk.roomId}`).emit("pk:ended", pk);

    clearPKTimer(pkId);
  }, duration * 1000);

  activeTimers.set(key, timer);
}

module.exports = { schedulePKEnd, clearPKTimer };
