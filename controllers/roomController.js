// controllers/roomController.js
const Room = require("../models/room");
const User = require("../models/users");
const { v4: uuidv4 } = require("uuid");

exports.createRoom = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userId = req.user.id;
    const { mode } = req.body;

    if (!mode) {
      return res.status(400).json({
        success: false,
        message: "Room mode required",
      });
    }

    const user = await User.findById(userId).select(
      "username email profile.avatar"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const roomId = uuidv4();

    const room = await Room.create({
      roomId, // ✅ UUID
      mode,
      title: `${mode} Room`,

      host: userId, // ✅ FIX (ObjectId)

      creator: userId,
      creatorName: user.username || user.email,
      creatorEmail: user.email,
      creatorAvatar: user.profile?.avatar || null,

      participants: [
        {
          user: userId,
          username: user.username,
          avatar: user.profile?.avatar || "/avatar.png",
          role: "host",
          joinedAt: new Date(),
        },
      ],

      stats: {
        totalJoins: 1,
        activeUsers: 1,
      },

      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: "Room created successfully",
      roomId: room.roomId, // 🔥 return UUID
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
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
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
      .sort({ createdAt: -1 })
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
    res.status(500).json({
      success: false,
      message: "Failed to fetch rooms",
      error: error.message,
    });
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

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

    room.title = title || room.title;
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
    res.status(500).json({
      success: false,
      message: "Failed to update room",
      error: error.message,
    });
  }
};

exports.deleteRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.host.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only host can delete room",
      });
    }

    room.isActive = false;
    room.endedAt = new Date();
    await room.save();

    res.status(200).json({
      success: true,
      message: "Room deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete room",
      error: error.message,
    });
  }
};

exports.joinRoom = async (req, res) => {
  try {
    const userId = req.user?.id;
    const roomId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const alreadyJoined = room.participants.some(
      (p) => p.user.toString() === userId
    );

    if (alreadyJoined) {
      return res.status(200).json({
        success: true,
        message: "Already joined",
        roomId: room.roomId,
        participants: room.participants,
      });
    }

    if (room.participants.length >= room.maxParticipants) {
      return res.status(400).json({
        success: false,
        message: "Room is full",
      });
    }

    const isHost = room.host.toString() === userId;

    room.participants.push({
      user: userId,
      username: req.user.username || req.user.email,
      avatar: req.user.avatar || "/avatar.png",
      role: isHost ? "host" : "listener",
      joinedAt: new Date(),
    });

    room.stats.totalJoins += 1;
    room.stats.activeUsers = room.participants.length;

    await room.save();
    await room.populate("participants.user", "username avatar");

    return res.status(200).json({
      success: true,
      message: "Joined room successfully",
      roomId: room.roomId,
      participants: room.participants,
    });
  } catch (error) {
    console.error("JOIN ROOM ERROR →", error);
    return res.status(500).json({
      success: false,
      message: "Failed to join room",
    });
  }
};


exports.leaveRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const beforeCount = room.participants.length;

    room.participants = room.participants.filter(
      (p) => p.user.toString() !== req.user.id
    );

    if (beforeCount === room.participants.length) {
      return res.status(400).json({
        success: false,
        message: "User not in room",
      });
    }

    room.stats.activeUsers = room.participants.length;

    await room.save();

    res.status(200).json({
      success: true,
      message: "Left room successfully",
    });
  } catch (error) {
    res.status(500).json({
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
      .sort({ "stats.totalJoins": -1 })
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
