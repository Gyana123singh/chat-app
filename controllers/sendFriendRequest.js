const Friend = require("../models/friend");
const FriendRequest = require("../models/friendRequest");
const User = require("../models/users");
const mongoose = require("mongoose");

/* ======================
   SEND FRIEND REQUEST
====================== */
exports.sendRequest = async (req, res) => {
  try {
    const from = req.user.id;
    const { to } = req.body;

    if (!mongoose.Types.ObjectId.isValid(to)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    if (from === to) {
      return res
        .status(400)
        .json({ message: "Cannot send request to yourself" });
    }

    // ✅ Check if target user exists
    const targetUser = await User.findById(to);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Check if already friends
    const alreadyFriend = await Friend.findOne({
      userId: from,
      friendId: to,
    });

    if (alreadyFriend) {
      return res.status(400).json({ message: "Already friends" });
    }

    // ✅ Check if request already exists
    const exists = await FriendRequest.findOne({
      $or: [
        { from, to },
        { from: to, to: from },
      ],
    });

    if (exists) {
      return res.status(400).json({ message: "Request already exists" });
    }

    const request = await FriendRequest.create({ from, to });

    // 🔔 SOCKET NOTIFICATION
    const io = req.app.get("io");
    const socketId = io.getSocketId(to);

    if (socketId) {
      io.to(socketId).emit("friend-request", {
        from,
        username: req.user.username,
      });
    }

    res.status(201).json({
      success: true,
      message: "Friend request sent",
      requestId: request._id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   ACCEPT FRIEND REQUEST
====================== */
exports.acceptRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;
    const { requestId } = req.body;

    const request = await FriendRequest.findOne({
      _id: requestId,
      to: userId,
      status: "pending",
    }).session(session);

    if (!request) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Request not found" });
    }

    // ✅ Check both directions to prevent duplicate friendship
    const alreadyFriend = await Friend.findOne({
      $or: [
        { userId: request.from, friendId: request.to },
        { userId: request.to, friendId: request.from },
      ],
    }).session(session);

    if (!alreadyFriend) {
      await Friend.insertMany(
        [
          { userId: request.from, friendId: request.to },
          { userId: request.to, friendId: request.from },
        ],
        { session },
      );
    }

    await FriendRequest.deleteOne({ _id: requestId }).session(session);

    await session.commitTransaction();
    session.endSession();

    // 🔔 Notify sender
    const io = req.app.get("io");
    const socketId = io.getSocketId(request.from.toString());

    if (socketId) {
      io.to(socketId).emit("friend-accepted", {
        by: userId,
        username: req.user.username,
      });
    }

    res.json({
      success: true,
      message: "Friend request accepted",
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   REJECT FRIEND REQUEST
====================== */
exports.rejectRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.body;

    const request = await FriendRequest.findOne({
      _id: requestId,
      to: userId,
      status: "pending",
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    await FriendRequest.deleteOne({ _id: requestId });

    res.json({
      success: true,
      message: "Friend request rejected",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   GET FRIEND REQUESTS
====================== */
exports.getRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const requests = await FriendRequest.find({
      to: userId,
      status: "pending",
    })
      .populate("from", "_id username profile.avatar level")
      .lean();

    const formatted = requests.map((r) => ({
      requestId: r._id,
      _id: r.from._id,
      username: r.from.username,
      avatar: r.from.profile?.avatar,
      level: r.from.level,
    }));

    res.json({
      success: true,
      requests: formatted,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   FRIEND LIST (CLEAN USER RESPONSE)
====================== */
exports.getFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    const friends = await Friend.find({ userId })
      .populate({
        path: "friendId",
        select: "_id username profile.avatar lastSeen level stats",
      })
      .lean();

    const formatted = friends.map((f) => ({
      _id: f.friendId._id,
      username: f.friendId.username,
      avatar: f.friendId.profile?.avatar,
      lastSeen: f.friendId.lastSeen,
      level: f.friendId.level,
      stats: f.friendId.stats,
    }));

    res.json({
      success: true,
      friends: formatted,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   FRIEND SUGGESTIONS
====================== */
exports.getFriendSuggestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const myId = new mongoose.Types.ObjectId(userId);

    // My friends
    const myFriends = await Friend.find({ userId }).select("friendId");
    const friendIds = myFriends.map((f) => f.friendId);

    // Existing requests
    const requests = await FriendRequest.find({
      $or: [{ from: userId }, { to: userId }],
    });

    const requestIds = requests.map((r) =>
      r.from.toString() === userId ? r.to : r.from,
    );

    // Friends of friends
    const mutuals = await Friend.aggregate([
      { $match: { userId: { $in: friendIds } } },
      {
        $group: {
          _id: "$friendId",
          mutualCount: { $sum: 1 },
        },
      },
      { $sort: { mutualCount: -1 } },
      { $limit: 20 },
    ]);

    const mutualIds = mutuals.map((m) => m._id);

    const exclude = [myId, ...friendIds, ...requestIds];

    const users = await User.find({
      _id: { $in: mutualIds, $nin: exclude },
      isActive: true,
    })
      .select("_id username profile.avatar stats.followers lastSeen")
      .limit(20);

    res.json({
      success: true,
      suggestions: users,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
