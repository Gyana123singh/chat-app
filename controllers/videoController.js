const VideoRoom = require("../models/videoRoom");
const fs = require("fs-extra");
const path = require("path");

exports.uploadAndPlayVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!roomId || !userId) {
      return res.status(400).json({ error: "roomId and userId are required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    let videoRoom = await VideoRoom.findOne({ roomId });

    if (!videoRoom) {
      videoRoom = await VideoRoom.create({
        roomId,
        hostId: userId, // first uploader becomes host
        video: { isVisible: false },
        audio: { isMixing: false },
        participants: [],
      });
    }

    const { originalname, filename, size, mimetype } = req.file;
    const videoUrl = `/video-stream/${roomId}/${filename}`;

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        video: {
          isPlaying: true,
          isPaused: false,
          currentTime: 0,
          duration: 0,
          fileName: filename,
          fileSize: size,
          mimeType: mimetype,
          isVisible: true,
          startedAt: new Date(),
          pausedAt: null,
        },
      },
      { new: true }
    );

    io.to(`room:${roomId}`).emit("video:started", {
      videoUrl: `http://${req.get("host")}${videoUrl}`,
      fileName: originalname,
      startedBy: userId,
      startedAt: Date.now(),
    });

    return res.json({
      success: true,
      message: "Video uploaded & started",
      videoUrl: `http://${req.get("host")}${videoUrl}`,
    });
  } catch (error) {
    console.error("❌ uploadAndPlayVideo:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.pauseVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        "video.isPaused": true,
        "video.isPlaying": false,
        "video.pausedAt": new Date(),
      }
    );

    io.to(`room:${roomId}`).emit("video:paused");
    res.json({ success: true });
  } catch (error) {
    console.error("❌ pauseVideo:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.resumeVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        "video.isPaused": false,
        "video.isPlaying": true,
      }
    );

    io.to(`room:${roomId}`).emit("video:resumed");
    res.json({ success: true });
  } catch (error) {
    console.error("❌ resumeVideo:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.stopVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    const videoRoom = await VideoRoom.findOne({ roomId });

    if (videoRoom?.video?.fileName) {
      const filePath = path.join(
        __dirname,
        "..",
        "..",
        "uploads",
        "videos",
        roomId,
        videoRoom.video.fileName
      );

      if (fs.existsSync(filePath)) {
        await fs.remove(filePath);
      }
    }

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        video: {
          isPlaying: false,
          isPaused: false,
          currentTime: 0,
          duration: 0,
          fileName: null,
          fileSize: 0,
          mimeType: "video/mp4",
          isVisible: false,
          startedAt: null,
          pausedAt: null,
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:stopped");
    res.json({ success: true });
  } catch (error) {
    console.error("❌ stopVideo:", error);
    res.status(500).json({ error: error.message });
  }
};
