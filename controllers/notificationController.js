const Notification = require("../models/notification");
const mongoose = require("mongoose");

exports.getNotifications = async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);

  const notifications = await Notification.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({ success: true, data: notifications });
};

exports.markAsRead = async (req, res) => {
  const { id } = req.params;

  await Notification.findByIdAndUpdate(id, {
    isRead: true,
    readAt: new Date(),
  });

  res.json({ success: true });
};
