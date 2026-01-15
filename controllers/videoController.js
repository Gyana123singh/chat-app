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
        hostId: userId,
        video: { isVisible: false },
        audio: { isMixing: false },
        participants: [],
        videos: [],
      });
    }

    const { originalname, filename, size, mimetype } = req.file;

    // ✅ PUSH INTO VIDEO LIST + SET CURRENT VIDEO
    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        $push: {
          videos: {
            fileName: filename,
            originalName: originalname,
            fileSize: size,
            mimeType: mimetype,
            uploadedAt: new Date(),
          },
        },
        $set: {
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
      },
      { new: true }
    );

    const videoUrl = `/video-stream/${roomId}/${filename}`;

    // 🔥 PLAY VIDEO EVENT
    io.to(`room:${roomId}`).emit("video:started", {
      videoUrl: `http://${req.get("host")}${videoUrl}`,
      fileName: originalname,
      startedBy: userId,
      startedAt: Date.now(),
    });

    // 🔥🔥 THIS IS WHAT YOU WERE MISSING – BROADCAST LIST UPDATE
    io.to(`room:${roomId}`).emit("video:list:updated");

    return res.json({
      success: true,
      message: "Video uploaded, added to list & started",
      videoUrl: `http://${req.get("host")}${videoUrl}`,
    });
  } catch (error) {
    console.error("❌ uploadAndPlayVideo:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getVideoList = async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ error: "roomId is required" });
    }

    const videoRoom = await VideoRoom.findOne({ roomId }).select("videos");

    if (!videoRoom || !videoRoom.videos || videoRoom.videos.length === 0) {
      return res.json({
        success: true,
        videos: [],
      });
    }

    const videos = videoRoom.videos.map((v) => ({
      fileName: v.fileName,
      originalName: v.originalName,
      fileSize: v.fileSize,
      mimeType: v.mimeType,
      url: `/video-stream/${roomId}/${v.fileName}`,
      uploadedAt: v.uploadedAt,
    }));

    return res.json({
      success: true,
      videos,
    });
  } catch (error) {
    console.error("❌ getVideoList error:", error);
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
