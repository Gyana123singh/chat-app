const Notification = require("../models/notification");
const mongoose = require("mongoose");

/* =========================
   GET USER NOTIFICATIONS
========================= */
exports.getNotifications = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    console.error("❌ Get notifications error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

/* =========================
   MARK NOTIFICATION AS READ
========================= */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const notification = await Notification.findByIdAndUpdate(
      id,
      {
        isRead: true,
        readAt: new Date(),
      },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  } catch (error) {
    console.error("❌ Mark as read error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update notification",
    });
  }
};
