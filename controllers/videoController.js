const VideoRoom = require("../models/videoRoom");
const fs = require("fs-extra");
const path = require("path");

function getCurrentVideoTime(video) {
  if (!video) return 0;

  // playing → calculate from startedAt
  if (video.isPlaying && video.startedAt) {
    const diff = (Date.now() - new Date(video.startedAt).getTime()) / 1000;
    return video.currentTime + diff;
  }

  // paused → return stored time
  return video.currentTime || 0;
}

exports.uploadVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!roomId || !userId) {
      return res.status(400).json({ error: "roomId and userId required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No video uploaded" });
    }

    let videoRoom = await VideoRoom.findOne({ roomId });

    if (!videoRoom) {
      videoRoom = await VideoRoom.create({
        roomId,
        hostId: userId,
        video: { isVisible: false },
        videos: [],
        participants: [],
      });
    }

    const { originalname, filename, size, mimetype } = req.file;

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        $push: {
          videos: {
            fileName: filename,
            originalName: originalname,
            fileSize: size,
            mimeType: mimetype,
          },
        },
        $set: {
          video: {
            isPlaying: false, // 🔥 IMPORTANT
            isPaused: false,
            currentTime: 0,
            fileName: filename,
            fileSize: size,
            mimeType: mimetype,
            isVisible: true,
            startedAt: null,
            pausedAt: null,
          },
        },
      },
    );

    io.to(`room:${roomId}`).emit("video:uploaded", {
      fileName: originalname,
    });

    res.json({ success: true, message: "Video uploaded (waiting for play)" });
  } catch (err) {
    console.error("❌ uploadVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.playVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom || !videoRoom.video.fileName) {
      return res.status(400).json({ error: "No video uploaded" });
    }

    const currentTime = getCurrentVideoTime(videoRoom.video);

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        "video.isPlaying": true,
        "video.isPaused": false,
        "video.startedAt": new Date(),
        "video.currentTime": currentTime,
      },
    );

    io.to(`room:${roomId}`).emit("video:play", {
      videoUrl: `/video-stream/${roomId}/${videoRoom.video.fileName}`,
      currentTime,
      startedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ playVideo:", err);
    res.status(500).json({ error: err.message });
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

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.json({ success: true });

    const currentTime = getCurrentVideoTime(videoRoom.video);

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        "video.isPaused": true,
        "video.isPlaying": false,
        "video.currentTime": currentTime,
        "video.pausedAt": new Date(),
      },
    );

    io.to(`room:${roomId}`).emit("video:paused", { currentTime });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ pauseVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.resumeVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.json({ success: true });

    await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        "video.isPaused": false,
        "video.isPlaying": true,
        "video.startedAt": new Date(),
      },
    );

    io.to(`room:${roomId}`).emit("video:resumed", {
      currentTime: videoRoom.video.currentTime,
      startedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ resumeVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.stopVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;

    const videoRoom = await VideoRoom.findOne({ roomId });

    if (videoRoom?.video?.fileName) {
      const filePath = path.resolve(
        process.cwd(),
        "uploads",
        "videos",
        roomId,
        videoRoom.video.fileName,
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
      },
    );

    io.to(`room:${roomId}`).emit("video:stopped");
    res.json({ success: true });
  } catch (error) {
    console.error("❌ stopVideo:", error);
    res.status(500).json({ error: error.message });
  }
};
