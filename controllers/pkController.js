const PKBattle = require("../models/pkBattle");
const Room = require("../models/room");
const { getIO } = require("../utils/socketService");
const schedulePKEnd = require("../utils/pkScheduler");

exports.createPK = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { roomId, leftUserId, rightUserId, mode, duration } = req.body;
    const hostId = req.user.id;

    const room = await Room.findById(roomId).session(session);
    if (!room) throw new Error("Room not found");

    if (room.host.toString() !== hostId) {
      throw new Error("Only host can start PK");
    }

    if (room.activePK) {
      throw new Error("PK already active in this room");
    }

    const pk = await PKBattle.create(
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

    room.activePK = pk[0]._id;
    await room.save({ session });

    await session.commitTransaction();

    getIO().to(`room:${roomId}`).emit("pk:started", pk[0]);

    schedulePKEnd(pk[0]._id, duration); // 🔥 SAFE TIMER

    res.json({ success: true, pk: pk[0] });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
};
