// controllers/block.controller.js
const Block = require("../models/blockUsers");

/**
 * BLOCK USER
 */
exports.blockUser = async (req, res) => {
  const blockerId = req.userId;
  const { blockedUserId } = req.body;

  if (blockerId === blockedUserId) {
    return res.status(400).json({ message: "You cannot block yourself" });
  }

  await Block.create({
    blocker: blockerId,
    blocked: blockedUserId,
  });

  res.json({ message: "User blocked successfully" });
};

/**
 * UNBLOCK USER
 */
exports.unblockUser = async (req, res) => {
  const blockerId = req.userId;
  const { blockedUserId } = req.body;

  await Block.findOneAndDelete({
    blocker: blockerId,
    blocked: blockedUserId,
  });

  res.json({ message: "User unblocked successfully" });
};

/**
 * GET BLOCKLIST
 */
exports.getBlockList = async (req, res) => {
  const blockerId = req.userId;

  const blockedUsers = await Block.find({ blocker: blockerId })
    .populate("blocked", "username diiId profile.avatar")
    .sort({ blockedAt: -1 });

  const formatted = blockedUsers.map((item) => ({
    userId: item.blocked._id,
    username: item.blocked.username,
    diiId: item.blocked.diiId,
    avatar: item.blocked.profile.avatar,
    blockedAt: item.blockedAt,
  }));

  res.json({
    totalBlocked: formatted.length,
    users: formatted,
  });
};
