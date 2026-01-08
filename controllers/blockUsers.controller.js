// controllers/block.controller.js
const Block = require("../models/blockUsers");

/**
 * BLOCK USER
 */
exports.blockUser = async (req, res) => {
  try {
    const blockerId = req.user.id; // logged-in user
    const blockedUserId = req.params.userId; // clicked user

    if (!blockedUserId) {
      return res.status(400).json({ message: "Target user is required" });
    }

    if (blockerId.toString() === blockedUserId.toString()) {
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
    const blockerId = req.user.id; // logged-in user
    const blockedUserId = req.params.userId; // clicked user

    if (!blockedUserId) {
      return res.status(400).json({ message: "Target user is required" });
    }

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
 * GET BLOCKLIST
 */
exports.getBlockList = async (req, res) => {
  try {
    const blockerId = req.user.id; // logged-in user

    const blockedUsers = await Block.find({ blocker: blockerId })
      .populate({
        path: "blocked",
        select: "username diiId profile.avatar",
      })
      .sort({ createdAt: -1 }); // or blockedAt if you have it

    const users = blockedUsers
      .filter((item) => item.blocked) // in case user is deleted
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
      error: error.message,
    });
  }
};
