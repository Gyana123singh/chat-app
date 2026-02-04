const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");
const { getIO } = require("../utils/socketService");
const { schedulePKEnd } = require("../utils/pkScheduler");
const mongoose = require("mongoose");

exports.createPK = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { roomId, leftUserId, rightUserId, mode, duration } = req.body;
    const hostId = req.user.id;

    // ✅ 1. Find room by STRING roomId
    const room = await Room.findOne({ roomId }).session(session);

    if (!room) throw new Error("Room not found");

    if (room.activePK) throw new Error("PK already active in this room");

    if (room.host.toString() !== hostId.toString()) {
      throw new Error("Only host can start PK");
    }

    // ✅ 2. Create PK
    const [pk] = await PKBattle.create(
      [
        {
          roomId,
          hostId,
          leftUser: { userId: leftUserId },
          rightUser: { userId: rightUserId },
          mode,
          duration,
          status: "running",
          startedAt: new Date(),
        },
      ],
      { session },
    );

    // ✅ 3. Attach PK to room
    room.activePK = pk._id;
    await room.save({ session });

    await session.commitTransaction();

    // 📡 Notify room
    getIO().to(`room:${roomId}`).emit("pk:started", pk);

    // ⏱ Auto end
    schedulePKEnd(pk._id, duration);

    res.json({ success: true, pk });
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ createPK error:", err.message);
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
};
