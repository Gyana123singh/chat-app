const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");
const { startPKTimer } = require("../utils/socketEvents");

// =========================
// START PK
// =========================
exports.createPK = async (req, res) => {
  try {
    const { roomId, leftUserId, rightUserId, mode, duration } = req.body;

    if (!roomId || !leftUserId || !rightUserId || !duration) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const room = await Room.findOne({ roomId });
    if (!room) {
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });
    }

    // 🚫 Anti-multiple-PK protection
    if (room.activePK) {
      return res
        .status(400)
        .json({ success: false, message: "PK already running in this room" });
    }

    const pk = await PKBattle.create({
      roomId: room.roomId,
      hostId: room.host,
      leftUser: { userId: leftUserId, score: 0 },
      rightUser: { userId: rightUserId, score: 0 },
      mode: mode || "coins",
      duration, // seconds
      status: "running",
      startedAt: new Date(),
    });

    room.activePK = pk._id;
    await room.save();

    const io = req.app.get("io");

    // 🔴 Notify clients
    io.to(`room:${room.roomId}`).emit("pk:started", pk);

    // ⏱️ START AUTO END TIMER ✅ (THIS IS THE IMPORTANT LINE)
    startPKTimer(pk, io);

    return res.json({ success: true, pk });
  } catch (err) {
    console.error("Start PK error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// =========================
// MANUAL END (OPTIONAL)
// =========================
exports.endPK = async (req, res) => {
  try {
    const { pkId } = req.params;
    if (!pkId) {
      return res.status(400).json({ success: false, message: "pkId required" });
    }

    const pk = await PKBattle.findById(pkId);
    if (!pk) {
      return res.status(404).json({ success: false, message: "PK not found" });
    }

    const io = req.app.get("io");

    // Ask socket layer to end PK properly
    io.to(`room:${pk.roomId}`).emit("pk:forceEnd", { pkId });

    return res.json({ success: true, message: "PK end requested" });
  } catch (err) {
    console.error("End PK error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
