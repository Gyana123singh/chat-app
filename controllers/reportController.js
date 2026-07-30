const Report = require("../models/report");
const User = require("../models/users");

// ===============================
// CREATE REPORT (USER / CLIENT / ADMIN)
// ===============================
exports.createReport = async (req, res) => {
  try {
    const { reportedUserId, userId, reason, details, type = "chat", targetId, reporterName } = req.body;

    const reportedUserTarget = reportedUserId || userId;

    if (!reportedUserTarget || !reason) {
      return res.status(400).json({
        success: false,
        message: "reportedUserId and reason are required",
      });
    }

    const userToReport = await User.findById(reportedUserTarget);
    if (!userToReport) {
      return res.status(404).json({
        success: false,
        message: "Reported user not found",
      });
    }

    const reporterId = req.user?.id || req.body.reportedById || null;

    const report = await Report.create({
      reportedUser: userToReport._id,
      reportedBy: reporterId,
      reporterName: reporterName || req.user?.username || "Anonymous",
      type,
      reason,
      details: details || "",
      targetId: targetId || null,
      status: "pending",
    });

    const populatedReport = await Report.findById(report._id)
      .populate("reportedUser", "username email profile.avatar isBanned displayId diiId phone")
      .populate("reportedBy", "username email profile.avatar");

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully",
      report: populatedReport,
    });
  } catch (error) {
    console.error("❌ CREATE REPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit report",
      error: error.message,
    });
  }
};

// ===============================
// GET ALL REPORTS (ADMIN)
// ===============================
exports.getAllReports = async (req, res) => {
  try {
    const { type, status } = req.query;

    const filter = {};
    if (type && type !== "all") filter.type = type;
    if (status && status !== "all") filter.status = status;

    const reports = await Report.find(filter)
      .populate("reportedUser", "username email profile.avatar isBanned displayId diiId phone role")
      .populate("reportedBy", "username email profile.avatar")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: reports.length,
      reports,
    });
  } catch (error) {
    console.error("❌ GET ALL REPORTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reports",
      error: error.message,
    });
  }
};

// ===============================
// UPDATE REPORT STATUS (ADMIN)
// ===============================
exports.updateReportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actionTaken } = req.body;

    if (!["pending", "resolved", "dismissed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Must be pending, resolved, or dismissed.",
      });
    }

    const report = await Report.findById(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    report.status = status;
    if (actionTaken) report.actionTaken = actionTaken;
    if (req.user?.id) report.resolvedBy = req.user.id;

    await report.save();

    const updatedReport = await Report.findById(report._id)
      .populate("reportedUser", "username email profile.avatar isBanned displayId diiId phone role")
      .populate("reportedBy", "username email profile.avatar");

    return res.status(200).json({
      success: true,
      message: `Report marked as ${status}`,
      report: updatedReport,
    });
  } catch (error) {
    console.error("❌ UPDATE REPORT STATUS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update report status",
      error: error.message,
    });
  }
};

// ===============================
// DELETE REPORT (ADMIN)
// ===============================
exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await Report.findByIdAndDelete(id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Report deleted successfully",
      id,
    });
  } catch (error) {
    console.error("❌ DELETE REPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete report",
      error: error.message,
    });
  }
};
