// controllers/roomController.js
const Room = require("../models/room");
const User = require("../models/users");
const { v4: uuidv4 } = require("uuid");
const VideoRoom = require("../models/videoRoom");
const mongoose = require("mongoose");

const findRoomByIdOrUuid = async (roomId, populateField = "") => {
  const query = {
    $or: [
      { roomId },
      ...(mongoose.Types.ObjectId.isValid(roomId) ? [{ _id: roomId }] : []),
    ],
  };
  let q = Room.findOne(query);
  if (populateField) {
    q = q.populate(populateField, "username avatar");
  }
  return await q;
};

exports.createRoom = async (req, res) => {
  try {
    // ✅ AUTH CHECK
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userId = req.user.id;

    // ✅ GET USER
    const user = await User.findById(userId).select(
      "username email profile.avatar roomName",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 🔥 CHECK EXISTING ACTIVE ROOM
    const existingRoom = await Room.findOne({
      creator: userId,
      isActive: true,
    });

    if (existingRoom) {
      return res.status(400).json({
        success: false,
        message: "You already have an active room",
        roomId: existingRoom.roomId,
      });
    }

    // ✅ GENERATE ROOM ID
    const roomId = uuidv4();

    // 🔥 FORCE MODE (NO PAYLOAD USED AT ALL)
    const safeMode = "Chat";

    // ✅ CREATE ROOM
    const room = await Room.create({
      roomId,
      mode: safeMode, // 💥 ALWAYS "Chat"
      title: user.roomName || "My Room",
      category: "Other",
      description: "",

      host: userId,
      creator: userId,
      creatorName: user.username || user.email,
      creatorEmail: user.email,
      creatorAvatar: user.profile?.avatar || null,
      status: "active",

      hostOnline: true,

      hostLeftAt: null,

      allowAudienceStay: true,

      currentUsers: 1,

      lastActivityAt: new Date(),

      participants: [
        {
          user: userId,
          role: "host",
          avatar: user.profile?.avatar || "/avatar.png",
          joinedAt: new Date(),
        },
      ],

      stats: {
        totalJoins: 1,
      },

      isActive: true,
    });

    // ✅ CREATE VIDEO ROOM
    await VideoRoom.create({
      roomId,
      hostId: userId,
      video: { isVisible: false },
      audio: { isMixing: false },
      participants: [
        {
          userId,
          role: "host",
          isReceivingVideo: false,
          videoFPS: 0,
          videoLatency: 0,
          lastVideoFrameReceived: 0,
        },
      ],
    });

    return res.status(201).json({
      success: true,
      message: "Room created successfully",
      roomId: room.roomId,
      room,
    });
  } catch (err) {
    console.error("CREATE ROOM ERROR →", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
/* =========================
   🎬 GET VIDEO STATS
========================= */
exports.getVideoStats = async (req, res) => {
  try {
    const { roomId } = req.params;
    const videoRoom = await VideoRoom.findOne({ roomId });

    if (!videoRoom) {
      return res.status(404).json({
        success: false,
        message: "Video room not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        video: videoRoom.video,
        audio: videoRoom.audio,
        frameSync: videoRoom.frameSync,
        stats: videoRoom.stats,
        participants: videoRoom.participants,
      },
    });
  } catch (error) {
    console.error("❌ getVideoStats error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* =========================
   🎬 UPDATE FRAME STATS
========================= */
exports.updateFrameStats = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { frameNumber, frameSize, latency } = req.body;

    if (!roomId || frameNumber === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing roomId or frameNumber",
      });
    }

    // ✅ FIX #6: NULL-COALESCING FOR LATENCY
    const safeLatency = Math.max(0, latency || 0);
    const safeFrameSize = Math.max(0, frameSize || 0);

    const videoRoom = await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        $inc: {
          "stats.totalFramesSent": 1,
          "stats.totalBandwidthUsed": safeFrameSize,
        },
        $push: {
          "frameSync.frameTimestamps": {
            frameNumber,
            capturedAt: new Date(),
            sentAt: new Date(),
            latency: safeLatency,
          },
        },
        $set: {
          "frameSync.lastFrameNumber": frameNumber,
          "video.lastSyncTime": new Date(),
        },
      },
      { new: true },
    );

    if (!videoRoom) {
      return res.status(404).json({
        success: false,
        message: "Video room not found",
      });
    }

    res.status(200).json({
      success: true,
      stats: videoRoom.stats,
    });
  } catch (error) {
    console.error("❌ updateFrameStats error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* =========================
   🎬 UPDATE LISTENER VIDEO STATUS
========================= */
exports.updateListenerVideoStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { isReceivingVideo, lastFrameNumber, fps, latency } = req.body;
    const userId = req.user.id;

    if (!roomId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing roomId or userId",
      });
    }

    // ✅ FIX #6: NULL-COALESCING FOR METRICS
    const safeLatency = Math.max(0, latency || 0);
    const safeFPS = Math.max(0, fps || 0);
    const safeFrameNumber = Math.max(0, lastFrameNumber || 0);

    const videoRoom = await VideoRoom.findOneAndUpdate(
      {
        roomId,
        "participants.userId": userId,
      },
      {
        $set: {
          "participants.$.isReceivingVideo": isReceivingVideo || false,
          "participants.$.lastVideoFrameReceived": safeFrameNumber,
          "participants.$.videoFPS": safeFPS,
          "participants.$.videoLatency": safeLatency,
          "video.lastSyncTime": new Date(),
        },
      },
      { new: true },
    );

    if (!videoRoom) {
      return res.status(404).json({
        success: false,
        message: "Video room or participant not found",
      });
    }

    const participant = videoRoom.participants.find(
      (p) => p.userId.toString() === userId.toString(),
    );

    res.status(200).json({
      success: true,
      message: "Listener status updated",
      participant,
    });
  } catch (error) {
    console.error("❌ updateListenerVideoStatus error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update listener status",
    });
  }
};

/* =========================
   🎬 RECORD VIDEO SESSION
========================= */
exports.recordVideoSession = async (req, res) => {
  try {
    const { roomId } = req.params;
    const {
      duration,
      totalFramesSent,
      avgFrameSize,
      totalBandwidth,
      droppedFrames,
      hostId,
      fps,
      latency,
    } = req.body;

    if (!roomId || !hostId) {
      return res.status(400).json({
        success: false,
        message: "Missing roomId or hostId",
      });
    }

    // ✅ FIX #6: NULL-COALESCING FOR SESSION DATA
    const safeDuration = Math.max(0, duration || 0);
    const safeFrames = Math.max(0, totalFramesSent || 0);
    const safeAvgSize = Math.max(0, avgFrameSize || 0);
    const safeBandwidth = Math.max(0, totalBandwidth || 0);
    const safeDropped = Math.max(0, droppedFrames || 0);
    const safeFPS = Math.max(0, fps || 30);
    const safeLatency = Math.max(0, latency || 100);

    const videoRoom = await VideoRoom.findOneAndUpdate(
      { roomId, hostId },
      {
        $set: {
          "stats.totalFramesSent": safeFrames,
          "stats.averageFrameSize": safeAvgSize,
          "stats.totalBandwidthUsed": safeBandwidth,
          "stats.droppedFrames": safeDropped,
          "video.isPlaying": false,
          "video.isPaused": false,
          isActive: false,
        },
        $currentDate: {
          "video.lastSyncTime": true,
        },
      },
      { new: true },
    );

    if (!videoRoom) {
      return res.status(404).json({
        success: false,
        message: "Video session not found",
      });
    }

    // Calculate estimated cost (coins per minute)
    const sessionDurationMinutes = safeDuration / 60000;
    const estimatedCost = Math.round(sessionDurationMinutes * 10);

    // ✅ FIX #6: CLAMP QUALITY SCORE TO 0-100
    const qualityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (safeFPS / 30) * 40 +
            (safeLatency <= 100 ? 30 : 20) +
            (safeDropped === 0 ? 30 : 10),
        ),
      ),
    );

    console.log(
      `📊 Session ended: ${safeFrames} frames, ${safeBandwidth} KB, Quality: ${qualityScore}/100`,
    );

    res.status(200).json({
      success: true,
      message: "Session recorded successfully",
      data: {
        sessionId: videoRoom._id,
        duration: safeDuration,
        totalFrames: safeFrames,
        totalBandwidth: safeBandwidth,
        estimatedCost,
        qualityScore,
      },
    });
  } catch (error) {
    console.error("❌ recordVideoSession error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to record session",
    });
  }
};

/* =========================
   🎬 GET VIDEO QUALITY METRICS
========================= */
exports.getVideoQualityMetrics = async (req, res) => {
  try {
    const { roomId } = req.params;

    const videoRoom = await VideoRoom.findOne({ roomId }).populate(
      "hostId",
      "username profile.avatar",
    );

    if (!videoRoom) {
      return res.status(404).json({
        success: false,
        message: "Video room not found",
      });
    }

    // ✅ FIX #6: SAFE CALCULATION WITH NULL-COALESCING
    const totalListeners = videoRoom.participants.filter(
      (p) => p.role === "listener",
    ).length;
    const activeListeners = videoRoom.participants.filter(
      (p) => p.isReceivingVideo === true,
    ).length;

    const participantCount = Math.max(1, videoRoom.participants.length);

    const avgFPS =
      Math.round(
        (videoRoom.participants.reduce((sum, p) => sum + (p.videoFPS || 0), 0) /
          participantCount) *
          10,
      ) / 10;

    const avgLatency = Math.round(
      videoRoom.participants.reduce(
        (sum, p) => sum + (p.videoLatency || 0),
        0,
      ) / participantCount,
    );

    const sessionDuration = Math.max(
      1,
      (videoRoom.video.lastSyncTime?.getTime() || Date.now()) -
        videoRoom.createdAt.getTime(),
    );
    const bandwidthPerSecond =
      Math.round(
        ((videoRoom.stats.totalBandwidthUsed || 0) / (sessionDuration / 1000)) *
          100,
      ) / 100;

    // ✅ FIX #6: CLAMP QUALITY SCORE TO 0-100
    const qualityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (avgFPS / 30) * 40 +
            (avgLatency <= 100 ? 30 : 20) +
            (videoRoom.stats.droppedFrames === 0 ? 30 : 10),
        ),
      ),
    );

    res.status(200).json({
      success: true,
      metrics: {
        // 📊 Video Stats
        isPlaying: videoRoom.video.isPlaying || false,
        currentTime: videoRoom.video.currentTime || 0,
        isVisible: videoRoom.video.isVisible || false,
        frameNumber: videoRoom.frameSync.lastFrameNumber || 0,

        // 📈 Quality Metrics
        avgFPS,
        avgLatency,
        expectedFPS: videoRoom.frameSync.expectedFPS || 30,
        totalListeners,
        activeListeners,
        listenerPercentage: totalListeners
          ? Math.round((activeListeners / totalListeners) * 100)
          : 0,

        // 💾 Bandwidth
        totalBandwidthUsed: videoRoom.stats.totalBandwidthUsed || 0,
        avgFrameSize: videoRoom.stats.averageFrameSize || 0,
        bandwidthPerSecond,

        // 🎯 Quality Score (0-100)
        qualityScore,

        // 👥 Participants Status
        participants: (videoRoom.participants || []).map((p) => ({
          userId: p.userId,
          role: p.role,
          isReceivingVideo: p.isReceivingVideo || false,
          fps: p.videoFPS || 0,
          latency: p.videoLatency || 0,
          lastFrame: p.lastVideoFrameReceived || 0,
        })),

        // 🖥️ Host Info
        host: videoRoom.hostId
          ? {
              id: videoRoom.hostId._id,
              username: videoRoom.hostId.username || "Unknown",
              avatar: videoRoom.hostId.profile?.avatar || null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("❌ getVideoQualityMetrics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch quality metrics",
    });
  }
};

/* =========================
   GET MY ROOMS
========================= */
exports.getMyRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ creator: req.user.id })
      .populate("creator", "username email")
      .sort({ createdAt: -1 })
      .lean();

    const formattedRooms = rooms.map((room) => {
      const creator = room.creator || {};
      return {
        ...room,
        creatorName: creator.username || creator.email || "Guest User",
      };
    });

    res.status(200).json({
      success: true,
      rooms: formattedRooms,
    });
  } catch (error) {
    console.error("❌ getMyRooms error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* =========================
   GET ROOM BY ID
========================= */
exports.getRoomById = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await findRoomByIdOrUuid(roomId, "participants.user");

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    res.status(200).json({
      success: true,
      room,
    });
  } catch (error) {
    console.error("❌ getRoomById error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch room",
    });
  }
};

/* =========================
   GET ALL ROOMS
========================= */
exports.getAllRooms = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;

    let query = { isActive: true, privacy: "public" };

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const rooms = await Room.find(query)
      .populate("host", "username profile.avatar stats")
      .sort({ isHelpRoom: -1, currentUsers: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Room.countDocuments(query);

    res.status(200).json({
      success: true,
      rooms,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("❌ getAllRooms error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch rooms",
      error: error.message,
    });
  }
};

/* =========================
   UPDATE ROOM
========================= */
exports.updateRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await findRoomByIdOrUuid(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.host.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only host can update room",
      });
    }

    const { title, description, category, privacy, maxParticipants, tags } =
      req.body;

    if (title && title.trim()) {
      room.title = title.trim();
      // Save it to User model so it is persisted for the next room creation
      await User.findByIdAndUpdate(req.user.id, { roomName: title.trim() });
    }
    room.description = description || room.description;
    room.category = category || room.category;
    room.privacy = privacy || room.privacy;
    room.maxParticipants = maxParticipants || room.maxParticipants;
    room.tags = tags || room.tags;

    await room.save();

    res.status(200).json({
      success: true,
      message: "Room updated successfully",
      room,
    });
  } catch (error) {
    console.error("❌ updateRoom error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update room",
      error: error.message,
    });
  }
};

/* =========================
   DELETE ROOM
========================= */
exports.deleteRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await findRoomByIdOrUuid(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const isHost = room.host.toString() === req.user.id;
    const isAdmin = req.user.role === "admin";

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only the host or an admin can delete the room",
      });
    }

    if ((room.isHelpRoom || room.createdByAdmin) && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Help or Admin-created Rooms can only be deleted by a Global Admin",
      });
    }

    // ✅ DELETE DB
    await VideoRoom.deleteOne({ roomId });

    // ✅ End active PK battle if running
    if (room.activePK) {
      const PKBattle = require("../models/pkBattle");
      await PKBattle.findByIdAndUpdate(room.activePK, {
        status: "ended",
        endedAt: new Date(),
      });
    }

    await Room.deleteOne({ roomId });

    // 🔥 SYNC SOCKET USERS
    const io = req.app.get("io");
    io.to(`room:${roomId}`).emit("room:closed");

    return res.status(200).json({
      success: true,
      message: "Room deleted successfully",
    });
  } catch (error) {
    console.error("❌ deleteRoom error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete room",
      error: error.message,
    });
  }
};

exports.joinRoom = async (req, res) => {
  try {
    const userId = req.user?.id;
    const roomId = req.params.roomId;

    console.log("🔍 JOIN REQUEST →", { userId, roomId });

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - No user ID",
      });
    }

    const room = await findRoomByIdOrUuid(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // ✅ FIX: Convert to strings for reliable comparison
    const userIdString = userId.toString();
    const hostId = room.host?.toString();
    const creatorId = room.creator?.toString();

    console.log("📊 Room data →", {
      roomId,
      hostId,
      creatorId,
      joiningUserId: userIdString,
    });

    // ✅ FIX: Check if already joined
    const alreadyJoined = room.participants.some((p) => {
      const participantUserId = p.user?.toString();
      return participantUserId === userIdString;
    });

    if (alreadyJoined) {
      console.log("✅ User already in room");
      return res.status(200).json({
        success: true,
        message: "Already joined",
        roomId: room.roomId,
        participants: room.participants,
      });
    }

    // ✅ Password Lock Verification
    if (room.isLocked && hostId !== userIdString && creatorId !== userIdString) {
      const { password } = req.body;
      if (!password) {
        return res.status(403).json({
          success: false,
          isLocked: true,
          message: "Password required to enter this room",
        });
      }
      if (password !== room.password) {
        return res.status(400).json({
          success: false,
          isLocked: true,
          message: "Incorrect room password",
        });
      }
    }

    // Check room capacity
    if (
      room.maxParticipants &&
      room.participants.length >= room.maxParticipants
    ) {
      return res.status(400).json({
        success: false,
        message: "Room is full",
      });
    }

    // ✅ FIX: Determine role - check both host and creator
    let role = "listener";
    if (hostId === userIdString || creatorId === userIdString) {
      role = "host";
    }

    console.log("👤 Adding participant →", {
      userId: userIdString,
      role,
      username: req.user.username || req.user.email,
    });

    // Add to participants
    room.participants.push({
      user: userId, // Store as ObjectId
      role,
      isMuted: false,
      isSpeaking: false,
      avatar: req.user.avatar || "/avatar.png",
      joinedAt: new Date(),
    });

    // Update stats
    room.stats.totalJoins += 1;
    room.stats.activeUsers = room.participants.length;

    // Save room
    await room.save();

    // Populate user details
    await room.populate("participants.user", "username avatar email");

    console.log("✅ Join successful →", {
      participants: room.participants.length,
      activeUsers: room.stats.activeUsers,
    });

    return res.status(200).json({
      success: true,
      message: "Joined room successfully",
      roomId: room.roomId,
      room: room, // ✅ Send full room data
      participants: room.participants,
    });
  } catch (error) {
    console.error("❌ JOIN ROOM ERROR →", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Failed to join room",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// controllers/roomController.js
exports.leaveRoom = async (req, res) => {
  try {
    const userId = req.user?.id;
    const roomId = req.params.roomId || req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const room = await findRoomByIdOrUuid(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // ❌ Prevent host from leaving
    if (room.host?.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Host cannot leave the room",
      });
    }

    const beforeCount = room.participants.length;

    room.participants = room.participants.filter(
      (p) => p.user.toString() !== userId.toString(),
    );

    if (beforeCount === room.participants.length) {
      return res.status(400).json({
        success: false,
        message: "User not in room",
      });
    }

    await room.save();

    return res.status(200).json({
      success: true,
      message: "Left room successfully",
      roomId: room.roomId,
      participantsCount: room.participants.length,
    });
  } catch (error) {
    console.error("LEAVE ROOM ERROR →", error);
    return res.status(500).json({
      success: false,
      message: "Failed to leave room",
      error: error.message,
    });
  }
};

exports.getPopularRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ isActive: true, privacy: "public" })
      .populate("host", "username profile.avatar")
      .sort({ isHelpRoom: -1, "stats.totalJoins": -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      rooms,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch popular rooms",
      error: error.message,
    });
  }
};

// ================= GET USER IN ROOM STATUS =================
exports.getUserInRoomStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const activeRoom = await Room.findOne({
      isActive: true,
      status: "active",
      "participants.user": userId,
    });

    if (activeRoom) {
      return res.status(200).json({
        success: true,
        inRoom: true,
        roomId: activeRoom.roomId,
      });
    }

    return res.status(200).json({
      success: true,
      inRoom: false,
      roomId: null,
    });
  } catch (error) {
    console.error("❌ getUserInRoomStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check user room status",
      error: error.message,
    });
  }
};

exports.setPassword = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    const room = await findRoomByIdOrUuid(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.host.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only the host can set a room password",
      });
    }

    room.password = password;
    room.isLocked = true;
    await room.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`room:${room.roomId}`).emit("room:lockedState", {
        roomId: room.roomId,
        isLocked: true,
      });
    }

    res.status(200).json({
      success: true,
      message: "Room password updated and locked successfully",
      room,
    });
  } catch (error) {
    console.error("❌ setPassword error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to set room password",
      error: error.message,
    });
  }
};

exports.unlockRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await findRoomByIdOrUuid(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.host.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only the host can unlock the room",
      });
    }

    room.password = null;
    room.isLocked = false;
    await room.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`room:${room.roomId}`).emit("room:lockedState", {
        roomId: room.roomId,
        isLocked: false,
      });
    }

    res.status(200).json({
      success: true,
      message: "Room unlocked successfully",
      room,
    });
  } catch (error) {
    console.error("❌ unlockRoom error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unlock room",
      error: error.message,
    });
  }
};
