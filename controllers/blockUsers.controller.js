const mongoose = require("mongoose");
const Block = require("../models/Block.model");

/**
 * BLOCK USER
 */
exports.blockUser = async (req, res) => {
  try {
    const blockerId = new mongoose.Types.ObjectId(req.user.id);
    const blockedUserId = new mongoose.Types.ObjectId(req.params.userId);

    if (blockerId.equals(blockedUserId)) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    const alreadyBlocked = await Block.findOne({
      blocker: blockerId,
      blocked: blockedUserId,
    });

    if (alreadyBlocked) {
      return res.status(409).json({ message: "User already blocked" });
    }

    await Block.create({
      blocker: blockerId,
      blocked: blockedUserId,
    });

    return res.status(200).json({ message: "User blocked successfully" });
  } catch (error) {
    console.error("blockUser error:", error);
    return res.status(500).json({
      message: "Failed to block user",
      error: error.message,
    });
  }
};

/**
 * UNBLOCK USER
 */
exports.unblockUser = async (req, res) => {
  try {
    const blockerId = new mongoose.Types.ObjectId(req.user.id);
    const blockedUserId = new mongoose.Types.ObjectId(req.params.userId);

    const result = await Block.findOneAndDelete({
      blocker: blockerId,
      blocked: blockedUserId,
    });

    if (!result) {
      return res.status(404).json({ message: "User not found in block list" });
    }

    return res.status(200).json({ message: "User unblocked successfully" });
  } catch (error) {
    console.error("unblockUser error:", error);
    return res.status(500).json({
      message: "Failed to unblock user",
      error: error.message,
    });
  }
};

/**
 * GET BLOCK LIST
 */
exports.getBlockList = async (req, res) => {
  try {
    const blockerId = new mongoose.Types.ObjectId(req.user.id);

    const blockedUsers = await Block.find({ blocker: blockerId })
      .populate("blocked", "username diiId profile.avatar")
      .sort({ createdAt: -1 });

    const users = blockedUsers
      .filter((item) => item.blocked)
      .map((item) => ({
        userId: item.blocked._id,
        username: item.blocked.username,
        diiId: item.blocked.diiId,
        avatar: item.blocked.profile?.avatar || null,
        blockedAt: item.createdAt,
      }));

    return res.status(200).json({
      success: true,
      totalBlocked: users.length,
      users,
    });
  } catch (error) {
    console.error("getBlockList error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch block list",
    });
  }
};
