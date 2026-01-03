const Friend = require("../models/friend");
const FriendRequest = require("../models/friendRequest");

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

    const exists = await FriendRequest.findOne({ from, to });
    if (exists) {
      return res.status(400).json({ message: "Request already sent" });
    }

    const request = await FriendRequest.create({ from, to });

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

    request.status = "accepted";
    await request.save();

    res.json({ message: "Friend request accepted", request });
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

    const friends = await FriendRequest.find({
      $or: [{ from: userId }, { to: userId }],
      status: "accepted",
    }).populate("from to", "username avatar");

    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
