// controllers/profileVisit.controller.js
const ProfileVisit = require("../models/profileVisit");

/**
 * RECORD PROFILE VISIT
 * Call this when someone opens a profile
 */
exports.recordVisit = async (req, res) => {
  const visitorId = req.userId;
  const { profileOwnerId } = req.body;

  if (visitorId === profileOwnerId) return res.sendStatus(204);

  // Prevent multiple visits in same day
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const alreadyVisited = await ProfileVisit.findOne({
    visitor: visitorId,
    profileOwner: profileOwnerId,
    visitedAt: { $gte: start, $lte: end },
  });

  if (!alreadyVisited) {
    await ProfileVisit.create({
      visitor: visitorId,
      profileOwner: profileOwnerId,
    });
  }

  res.sendStatus(200);
};

/**
 * GET PROFILE VISITORS LIST
 */
exports.getVisitors = async (req, res) => {
  const userId = req.userId;

  const visits = await ProfileVisit.find({ profileOwner: userId })
    .populate("visitor", "username profile.avatar lastSeen")
    .sort({ visitedAt: -1 });

  const today = [];
  const yesterday = [];
  const older = [];

  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);

  visits.forEach((v) => {
    const visitDate = v.visitedAt;

    const data = {
      userId: v.visitor._id,
      username: v.visitor.username,
      avatar: v.visitor.profile.avatar,
      visitedAt: v.visitedAt,
      online:
        Date.now() - new Date(v.visitor.lastSeen).getTime() < 5 * 60 * 1000,
    };

    if (visitDate >= todayStart) today.push(data);
    else if (visitDate >= yesterdayStart) yesterday.push(data);
    else older.push(data);
  });

  res.json({
    totalVisitors: visits.length,
    newToday: today.length,
    today,
    yesterday,
    older,
  });
};
