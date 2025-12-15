// controllers/roomController.js
const Room = require("../models/room");
const User = require("../models/users");

exports.createRoom = async (req, res) => {
  try {
    const { title, description, category, privacy, maxParticipants, tags } =
      req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Room title is required",
      });
    }

    const room = new Room({
      title,
      description: description || "",
      category: category || "Other",
      privacy: privacy || "public",
      maxParticipants: maxParticipants || 100,
      tags: tags || [],
      host: req.user.id,
      participants: [
        {
          user: req.user.id,
          role: "host",
        },
      ],
    });

    await room.save();
    await room.populate("host", "username profile.avatar");

    res.status(201).json({
      success: true,
      message: "Room created successfully",
      room,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create room",
      error: error.message,
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

exports.getRoomById = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate("host", "username profile.avatar stats")
      .populate("participants.user", "username profile.avatar");

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
    res.status(500).json({
      success: false,
      message: "Failed to fetch room",
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
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const isAlreadyParticipant = room.participants.some(
      (p) => p.user.toString() === req.user.id
    );

    if (isAlreadyParticipant) {
      return res.status(400).json({
        success: false,
        message: "Already in this room",
      });
    }

    if (room.participants.length >= room.maxParticipants) {
      return res.status(400).json({
        success: false,
        message: "Room is full",
      });
    }

    room.participants.push({
      user: req.user.id,
      role: "listener",
    });

    room.stats.totalJoins += 1;
    await room.save();

    res.status(200).json({
      success: true,
      message: "Joined room successfully",
      room,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to join room",
      error: error.message,
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

    room.participants = room.participants.filter(
      (p) => p.user.toString() !== req.user.id
    );

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
