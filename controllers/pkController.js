const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");

exports.createPK = async (req, res) => {
  try {
    const { roomId, leftUserId, rightUserId, mode, duration } = req.body;
    const userId = req.user._id;

    const room = await Room.findOne({ roomId });

    if (!room) return res.status(404).json({ message: "Room not found" });

    // ✅ Only host can create PK
    if (room.host.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Only host can start PK" });
    }

    // ❌ If already active PK
    if (room.activePK) {
      return res.status(400).json({ message: "PK already running" });
    }

    const pk = await PKBattle.create({
      roomId,
      hostId: userId,
      leftUser: { userId: leftUserId, score: 0 },
      rightUser: { userId: rightUserId, score: 0 },
      mode,
      duration,
      status: "pending",
    });

    room.activePK = pk._id;
    await room.save();

    res.json({ success: true, pk });
  } catch (err) {
    console.error("Create PK error:", err);
    res.status(500).json({ message: "Failed to create PK" });
  }
};
