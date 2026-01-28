const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");
const { getIO } = require("../utils/socketService");

exports.createPK = async (req, res) => {
  try {
    const { roomId, leftUserId, rightUserId, mode, duration } = req.body;
    const hostId = req.user.id;

    // ❌ Validate room
    const room = await Room.findById(roomId);

    if (!room) return res.status(404).json({ message: "Rooms not found" });

    // ❌ Only host
    if (room.host.toString() !== hostId) {
      return res.status(403).json({
        message: "Only host can start PK",
      });
    }

    // ❌ Only one PK at a time
    const existingPK = await PKBattle.findOne({
      roomId,
      status: "running",
    });

    if (existingPK) {
      return res.status(400).json({
        message: "PK already running in this room",
      });
    }

    // ✅ Create PK
    const pk = await PKBattle.create({
      roomId,
      hostId,
      leftUser: { userId: leftUserId },
      rightUser: { userId: rightUserId },
      mode,
      duration,
      status: "running", // ✅ REQUIRED
      startedAt: new Date(), // ✅ REQUIRED
    });

    // 🔥 notify room
    getIO().to(`room:${roomId}`).emit("pk:started", pk);

    // ⏱ auto end
    setTimeout(async () => {
      const battle = await PKBattle.findById(pk._id);
      if (!battle || battle.status !== "running") return;

      battle.status = "ended";
      battle.endedAt = new Date();

      if (battle.leftUser.score > battle.rightUser.score) {
        battle.winner = battle.leftUser.userId;
      } else if (battle.rightUser.score > battle.leftUser.score) {
        battle.winner = battle.rightUser.userId;
      }

      await battle.save();

      getIO().to(`room:${roomId}`).emit("pk:ended", battle);
    }, duration * 1000);

    return res.json({
      success: true,
      pk,
    });
  } catch (err) {
    console.error("❌ createPK error:", err.message);
    res.status(500).json({ message: err.message });
  }
};
