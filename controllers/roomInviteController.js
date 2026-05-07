const RoomInvite = require("../models/roomInvite");

exports.getForYouInvites = async (req, res) => {
  try {
    const userId = req.user.id;

    const invites = await RoomInvite.find({
      invitedUsers: userId,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      invites,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};