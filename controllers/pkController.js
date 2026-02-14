const PKBattle = require("../models/pkBattle"); // ✅ FIXED CASE
const Room = require("../models/room"); // ✅ FIXED CASE
const mongoose = require("mongoose");

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
      duration,
      status: "running",
      startedAt: new Date(),
    });

    room.activePK = pk._id;
    await room.save();

    // ✅ Emit to correct socket room
    const io = req.app.get("io");
    io.to(`room:${room.roomId}`).emit("pk:started", pk);

    return res.json({ success: true, pk });
  } catch (err) {
    console.error("Start PK error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// =========================
// CONTRIBUTE (Vote / Gift / Coin)
// =========================
exports.contributePK = async (req, res) => {
  try {
    const { pkId, toUserId, value = 1, giftId = null } = req.body;

    if (!pkId || !toUserId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const pk = await PKBattle.findById(pkId);
    if (!pk || pk.status !== "running") {
      return res
        .status(400)
        .json({ success: false, message: "PK not running" });
    }

    // Save contribution
    pk.contributions.push({
      fromUser: req.user?._id || null, // if you have auth middleware
      toUser: toUserId,
      giftId,
      value,
    });

    // Increase score
    if (pk.leftUser.userId.toString() === toUserId.toString()) {
      pk.leftUser.score += value;
    } else if (pk.rightUser.userId.toString() === toUserId.toString()) {
      pk.rightUser.score += value;
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid target user" });
    }

    await pk.save();

    // ✅ Emit update to correct socket room
    const io = req.app.get("io");
    io.to(`room:${pk.roomId}`).emit("pk:update", {
      pkId: pk._id,
      leftScore: pk.leftUser.score,
      rightScore: pk.rightUser.score,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Contribute PK error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// =========================
// MANUAL END (OPTIONAL)
// =========================
// ⚠️ Recommended: Let SOCKET handle real end + timers.
// This just notifies socket layer.
exports.endPK = async (req, res) => {
  try {
    const { pkId } = req.params;
    if (!pkId) {
      return res.status(400).json({ success: false, message: "pkId required" });
    }

    const io = req.app.get("io");

    // 🔔 Ask socket layer to end PK
    io.to(`room:${roomId}`).emit("pk:forceEnd", { pkId });

    return res.json({ success: true, message: "PK end requested" });
  } catch (err) {
    console.error("End PK error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
