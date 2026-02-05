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

    // ✅ 0. Basic validation
    if (!roomId || !mode || !duration) {
      throw new Error("Missing required fields");
    }

    // ✅ 0.1 Validate user IDs
    if (
      !mongoose.Types.ObjectId.isValid(leftUserId) ||
      !mongoose.Types.ObjectId.isValid(rightUserId)
    ) {
      throw new Error("Invalid user id(s)");
    }

    // ✅ 1. Find room by STRING roomId (UUID)
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
          duration: Number(duration), // ✅ ensure number
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
    schedulePKEnd(pk._id, Number(duration));

    res.json({ success: true, pk });
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ createPK error:", err.message);
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
};

/**
 * GET /api/pk/history?roomId=xxx&userId=xxx&page=1&limit=20
 */
exports.getPKHistory = async (req, res) => {
  try {
    const { roomId, userId, page = 1, limit = 20 } = req.query;

    const query = { status: "ended" };

    if (roomId) query.roomId = roomId;

    if (userId) {
      query.$or = [
        { "leftUser.userId": userId },
        { "rightUser.userId": userId },
      ];
    }

    const skip = (page - 1) * limit;

    const list = await PKBattle.find(query)
      .populate("leftUser.userId", "username profile.avatar")
      .populate("rightUser.userId", "username profile.avatar")
      .populate("winner", "username profile.avatar")
      .sort({ endedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await PKBattle.countDocuments(query);

    res.json({
      success: true,
      data: list,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("❌ getPKHistory error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load PK history" });
  }
};
/**
 * GET /api/pk/leaderboard?page=1&limit=20
 */
exports.getPKLeaderboard = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { status: "ended", winner: { $ne: null } } },

      {
        $group: {
          _id: "$winner",
          wins: { $sum: 1 },
          totalBattles: { $sum: 1 },
        },
      },

      { $sort: { wins: -1 } },

      { $skip: skip },
      { $limit: Number(limit) },

      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },

      { $unwind: "$user" },

      {
        $project: {
          userId: "$user._id",
          username: "$user.username",
          avatar: "$user.profile.avatar",
          wins: 1,
          totalBattles: 1,
        },
      },
    ];

    const rows = await PKBattle.aggregate(pipeline);

    res.json({
      success: true,
      leaderboard: rows,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("❌ getPKLeaderboard error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load PK leaderboard" });
  }
};


/**
 * GET /api/pk/leaderboard?page=1&limit=20
 */
exports.getPKLeaderboard = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { status: "ended", winner: { $ne: null } } },

      {
        $group: {
          _id: "$winner",
          wins: { $sum: 1 },
          totalBattles: { $sum: 1 },
        },
      },

      { $sort: { wins: -1 } },

      { $skip: skip },
      { $limit: Number(limit) },

      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },

      { $unwind: "$user" },

      {
        $project: {
          userId: "$user._id",
          username: "$user.username",
          avatar: "$user.profile.avatar",
          wins: 1,
          totalBattles: 1,
        },
      },
    ];

    const rows = await PKBattle.aggregate(pipeline);

    res.json({
      success: true,
      leaderboard: rows,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("❌ getPKLeaderboard error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load PK leaderboard" });
  }
};
