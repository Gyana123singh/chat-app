const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");
const { startPKTimer } = require("../utils/socketEvents");

// =========================
// START PK
// =========================
exports.createPK = async (req, res) => {
  try {
    const { roomId, leftUserId, rightUserId, mode, duration } = req.body;

    // ✅ Basic validation
    if (!roomId || !leftUserId || !rightUserId || !duration) {
      return res.status(400).json({
        success: false,
        message: "Missing fields",
      });
    }

    // =========================
    // ✅ FIX: Convert to number (VERY IMPORTANT)
    // =========================
    const parsedDuration = Number(duration);

    // =========================
    // ✅ Allowed durations
    // =========================
    const allowedDurations = [15, 30, 60, 300, 600, 900];

    if (!allowedDurations.includes(parsedDuration)) {
      return res.status(400).json({
        success: false,
        message: "Invalid duration. Allowed: 15s, 30s, 1m, 5m, 10m, 15m",
      });
    }

    // =========================
    // ✅ Room check
    // =========================
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // 🚫 Prevent multiple PK
    if (room.activePK) {
      return res.status(400).json({
        success: false,
        message: "PK already running in this room",
      });
    }

    // =========================
    // ✅ Create PK
    // =========================
    const pk = await PKBattle.create({
      roomId: room.roomId,
      hostId: room.creator || room.host,
      leftUser: { userId: leftUserId, score: 0 },
      rightUser: { userId: rightUserId, score: 0 },
      mode: mode || "coins",
      duration: parsedDuration, // ✅ use parsed value
      status: "running",
      startedAt: new Date(),
    });

    // =========================
    // ✅ Save active PK
    // =========================
    room.activePK = pk._id;
    await room.save();

    const io = req.app.get("io");

    // =========================
    // 📢 Notify clients
    // =========================
    io.to(`room:${room.roomId}`).emit("pk:started", pk);

    // =========================
    // ⏱️ Start Timer
    // =========================
    startPKTimer(pk, io);

    return res.json({
      success: true,
      pk,
    });
  } catch (err) {
    console.error("❌ Start PK error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
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

// =========================
// PK HISTORY
// =========================
exports.getPKHistory = async (req, res) => {
  try {
    const { roomId } = req.params;

    const list = await PKBattle.find({ roomId, status: "ended" })
      .sort({ endedAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, data: list });
  } catch (err) {
    console.error("Get PK history error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// =========================
// PK LEADERBOARD
// =========================
exports.getPKLeaderboard = async (req, res) => {
  try {
    const type = req.query.type || "wins"; // wins | support | received

    let sort = {};
    if (type === "wins") sort = { "pkStats.wins": -1 };
    if (type === "support") sort = { "pkStats.totalSupportSent": -1 };
    if (type === "received") sort = { "pkStats.totalSupportReceived": -1 };

    const users = await User.find({})
      .sort(sort)
      .limit(50)
      .select("username avatar pkStats")
      .lean();

    return res.json({ success: true, data: users });
  } catch (err) {
    console.error("Get PK leaderboard error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
