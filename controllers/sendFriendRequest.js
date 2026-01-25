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

    if (from === to) {
      return res
        .status(400)
        .json({ message: "Cannot send request to yourself" });
    }
    const exists = await FriendRequest.findOne({
      $or: [
        { from, to },
        { from: to, to: from },
      ],
    });

    if (exists) {
      return res.status(400).json({ message: "Request already sent" });
    }

    const request = await FriendRequest.create({ from, to });

    // 🔔 SOCKET NOTIFICATION (ADD HERE)
    const io = req.app.get("io");
    const socketId = io.getSocketId(to);

    if (socketId) {
      io.to(socketId).emit("friend-request", {
        from,
        username: req.user.username,
      });
    }

    res.status(201).json({ message: "Friend request sent", request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   ACCEPT FRIEND REQUEST
====================== */
exports.acceptRequest = async (req, res) => {
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
    const alreadyFriend = await Friend.findOne({
      userId: request.from,
      friendId: request.to,
    });

    if (alreadyFriend) {
      return res.json({ message: "Already friends" });
    }

    // create friends
    await Friend.create([
      { userId: request.from, friendId: request.to },
      { userId: request.to, friendId: request.from },
    ]);

    // 🔥 clean DB
    await FriendRequest.deleteOne({ _id: requestId });

    // realtime
    const io = req.app.get("io");
    const socketId = io.getSocketId(request.from.toString());

    if (socketId) {
      io.to(socketId).emit("friend-accepted", {
        by: userId,
        username: req.user.username,
      });
    }

    res.json({ message: "Friend request accepted" });
  } catch (err) {
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

    request.status = "rejected";
    await request.save();

    res.json({ message: "Friend request rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   GET ALL REQUESTS
====================== */
exports.getRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const requests = await FriendRequest.find({
      to: userId,
      status: "pending",
    }).populate("from", "username avatar");

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ======================
   FRIEND LIST
====================== */
exports.getFriends = async (req, res) => {
  try {
    const userId = req.user.id;

    const friends = await Friend.find({ userId }).populate(
      "friendId",
      "username profile.avatar lastSeen",
    );

    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getFriendSuggestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const myId = new mongoose.Types.ObjectId(userId);

    // 1️⃣ My friends
    const myFriends = await Friend.find({ userId }).select("friendId");
    const friendIds = myFriends.map((f) => f.friendId);

    // 2️⃣ Requests
    const requests = await FriendRequest.find({
      $or: [{ from: userId }, { to: userId }],
    });

    const requestIds = requests.map((r) =>
      r.from.toString() === userId ? r.to : r.from,
    );

    // 3️⃣ Friends of friends
    const mutuals = await Friend.aggregate([
      {
        $match: {
          userId: { $in: friendIds },
        },
      },
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

    // 4️⃣ Exclude
    const exclude = [myId, ...friendIds, ...requestIds];

    // 5️⃣ Final suggestions
    const users = await User.find({
      _id: { $in: mutualIds, $nin: exclude },
      isActive: true,
    })
      .select("username profile.avatar stats.followers lastSeen")
      .limit(20);

    res.json({
      success: true,
      suggestions: users,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
