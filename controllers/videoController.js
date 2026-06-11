const VideoRoom = require("../models/videoRoom");
const fs = require("fs-extra");
const path = require("path");

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Returns true if userId matches the current video controllerId.
 * Kept for backward compatibility – used by pause/resume (legacy callers
 * that haven't sent a videoId yet still work).
 */
function canControlVideo(videoRoom, userId) {
  if (!videoRoom || !videoRoom.video) return false;
  return (
    videoRoom.video.controllerId?.toString() === userId?.toString()
  );
}

/**
 * Calculates elapsed playback time accounting for live drift.
 */
function getCurrentVideoTime(video) {
  if (!video) return 0;
  if (video.isPlaying && video.startedAt) {
    const diff = (Date.now() - new Date(video.startedAt).getTime()) / 1000;
    return (video.currentTime || 0) + diff;
  }
  return video.currentTime || 0;
}

/**
 * Returns the index of the video currently tracked by currentVideoId.
 * Returns -1 if not set or not found.
 */
function getCurrentIndex(videos, currentVideoId) {
  if (!currentVideoId) return -1;
  return videos.findIndex(
    (v) => v._id && v._id.toString() === currentVideoId.toString()
  );
}

// ─────────────────────────────────────────────
// UPLOAD (existing – unchanged)
// ─────────────────────────────────────────────

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

    // Push to playlist and set current playback state
    const updated = await VideoRoom.findOneAndUpdate(
      { roomId },
      {
        $push: {
          videos: {
            fileName: filename,
            originalName: originalname,
            fileSize: size,
            mimeType: mimetype,
            uploadedBy: userId,
          },
        },
        $set: {
          "video.isPlaying": true,
          "video.isPaused": false,
          "video.currentTime": 0,
          "video.fileName": filename,
          "video.fileSize": size,
          "video.mimeType": mimetype,
          "video.isVisible": true,
          "video.controllerId": userId,
          "video.startedAt": new Date(),
          "video.pausedAt": null,
        },
      },
      { new: true }
    );

    // Set currentVideoId to the newly added video's _id
    if (updated) {
      const newVideo = updated.videos[updated.videos.length - 1];
      await VideoRoom.updateOne(
        { roomId },
        { $set: { "video.currentVideoId": newVideo._id } }
      );
    }

    // Force WebRTC renegotiation BEFORE video:play
    io.to(`room:${roomId}`).emit("video:stream:ready", { from: userId });

    // 🔥 EMIT PLAY TO ALL USERS (AUTO PLAY)
    io.to(`room:${roomId}`).emit("video:play", {
      videoUrl: `/video-stream/${roomId}/${filename}`,
      currentTime: 0,
      startedAt: Date.now(),
      controllerId: userId,
      fileName: originalname,
    });

    res.json({ success: true, message: "Video uploaded and streaming started" });
  } catch (err) {
    console.error("❌ uploadVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// PLAY (extended – backward-compatible)
// ─────────────────────────────────────────────

exports.playVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId, videoId } = req.body; // videoId is optional

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) {
      return res.status(404).json({ error: "Room not found" });
    }

    let fileName = videoRoom.video?.fileName;
    let controllerId = videoRoom.video?.controllerId;
    let targetVideoId = videoRoom.video?.currentVideoId;

    if (videoId) {
      // ── Replay from playlist ──────────────────────────────────────
      const selectedVideo = videoRoom.videos.id(videoId);
      if (!selectedVideo) {
        return res.status(404).json({ message: "Video not found in playlist." });
      }

      // The uploader of the selected video becomes the controller
      fileName = selectedVideo.fileName;
      controllerId = selectedVideo.uploadedBy;
      targetVideoId = selectedVideo._id;

      // Authorization: only the uploader of THIS video may play it
      if (selectedVideo.uploadedBy.toString() !== userId.toString()) {
        return res.status(403).json({
          message: "Only uploader of this video can control playback.",
        });
      }

      // Update DB to point at new video
      await VideoRoom.updateOne(
        { roomId },
        {
          $set: {
            "video.fileName": fileName,
            "video.controllerId": controllerId,
            "video.currentVideoId": targetVideoId,
          },
        }
      );
    } else {
      // ── Legacy / resume same video ────────────────────────────────
      // Authorization: only existing controller may call play
      if (!canControlVideo(videoRoom, userId)) {
        return res.status(403).json({
          message: "Only uploader of this video can control playback.",
        });
      }

      if (!fileName) {
        return res.status(400).json({ error: "No video uploaded" });
      }
    }

    const currentTime = videoId ? 0 : getCurrentVideoTime(videoRoom.video);

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.isPlaying": true,
          "video.isPaused": false,
          "video.startedAt": new Date(),
          "video.currentTime": currentTime,
        },
      }
    );

    // 1️⃣ Force WebRTC renegotiation BEFORE video:play
    io.to(`room:${roomId}`).emit("video:stream:ready", { from: userId });

    // 2️⃣ Broadcast play event (unchanged shape for backward compat)
    io.to(`room:${roomId}`).emit("video:play", {
      videoUrl: `/video-stream/${roomId}/${fileName}`,
      currentTime,
      startedAt: Date.now(),
      controllerId,
      fileName,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ playVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET VIDEO LIST (existing – unchanged)
// ─────────────────────────────────────────────

exports.getVideoList = async (req, res) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ error: "roomId is required" });
    }

    const videoRoom = await VideoRoom.findOne({ roomId }).select("videos video");

    if (!videoRoom || !videoRoom.videos || videoRoom.videos.length === 0) {
      return res.json({ success: true, videos: [] });
    }

    const currentVideoId = videoRoom.video?.currentVideoId?.toString();

    const videos = videoRoom.videos.map((v) => ({
      id: v._id.toString(),
      fileName: v.fileName,
      originalName: v.originalName,
      fileSize: v.fileSize,
      mimeType: v.mimeType,
      url: `/video-stream/${roomId}/${v.fileName}`,
      uploadedAt: v.uploadedAt,
      uploadedBy: v.uploadedBy?.toString(),
      isCurrent: v._id.toString() === currentVideoId,
    }));

    return res.json({ success: true, videos });
  } catch (error) {
    console.error("❌ getVideoList error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────
// PAUSE (existing – extended with better auth)
// ─────────────────────────────────────────────

exports.pauseVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }
    if (!videoRoom) return res.json({ success: true });

    const currentTime = getCurrentVideoTime(videoRoom.video);

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.isPaused": true,
          "video.isPlaying": false,
          "video.currentTime": currentTime,
          "video.pausedAt": new Date(),
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:paused", {
      currentTime,
      controllerId: videoRoom.video.controllerId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ pauseVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// RESUME (existing – extended with better auth)
// ─────────────────────────────────────────────

exports.resumeVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }
    if (!videoRoom) return res.json({ success: true });

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.isPaused": false,
          "video.isPlaying": true,
          "video.startedAt": new Date(),
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:resumed", {
      currentTime: videoRoom.video.currentTime,
      startedAt: Date.now(),
      controllerId: videoRoom.video.controllerId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ resumeVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// STOP (fixed – keeps playlist intact)
// ─────────────────────────────────────────────

exports.stopVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    // ✅ ONLY reset playback state – DO NOT touch videos[] or fileName
    // Keeping fileName lets us replay the same video without re-uploading
    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.isPlaying": false,
          "video.isPaused": false,
          "video.isVisible": false,
          "video.currentTime": 0,
          "video.startedAt": null,
          "video.pausedAt": null,
          // controllerId & fileName & currentVideoId intentionally preserved
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:stopped", {
      controllerId: videoRoom.video.controllerId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ stopVideo:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────
// SELECT VIDEO (new)
// ─────────────────────────────────────────────

exports.selectVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId, videoId } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: "videoId is required" });
    }

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.status(404).json({ error: "Room not found" });

    const selectedVideo = videoRoom.videos.id(videoId);
    if (!selectedVideo) {
      return res.status(404).json({ message: "Video not found in playlist." });
    }

    // Only the uploader of the selected video can select it
    if (selectedVideo.uploadedBy.toString() !== userId.toString()) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.fileName": selectedVideo.fileName,
          "video.controllerId": selectedVideo.uploadedBy,
          "video.currentVideoId": selectedVideo._id,
          "video.currentTime": 0,
          "video.isPlaying": false,
          "video.isPaused": false,
        },
      }
    );

    // Force renegotiation so Flutter rebuilds peer connections
    io.to(`room:${roomId}`).emit("video:stream:ready", { from: userId });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ selectVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// NEXT VIDEO (new)
// ─────────────────────────────────────────────

exports.nextVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.status(404).json({ error: "Room not found" });

    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    const idx = getCurrentIndex(videoRoom.videos, videoRoom.video?.currentVideoId);
    if (idx === -1 || idx >= videoRoom.videos.length - 1) {
      // Already at last – stay, no crash
      return res.json({ success: true, message: "Already at last video." });
    }

    const next = videoRoom.videos[idx + 1];

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.fileName": next.fileName,
          "video.controllerId": next.uploadedBy,
          "video.currentVideoId": next._id,
          "video.currentTime": 0,
          "video.isPlaying": true,
          "video.isPaused": false,
          "video.startedAt": new Date(),
        },
      }
    );

    // 1️⃣ Renegotiate
    io.to(`room:${roomId}`).emit("video:stream:ready", { from: userId });
    // 2️⃣ Track changed
    io.to(`room:${roomId}`).emit("video:trackChanged", {
      videoId: next._id,
      fileName: next.fileName,
      controllerId: next.uploadedBy,
    });
    // 3️⃣ Play
    io.to(`room:${roomId}`).emit("video:play", {
      videoUrl: `/video-stream/${roomId}/${next.fileName}`,
      currentTime: 0,
      startedAt: Date.now(),
      controllerId: next.uploadedBy,
      fileName: next.fileName,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ nextVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// PREVIOUS VIDEO (new)
// ─────────────────────────────────────────────

exports.previousVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.status(404).json({ error: "Room not found" });

    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    const idx = getCurrentIndex(videoRoom.videos, videoRoom.video?.currentVideoId);
    if (idx <= 0) {
      // Already at first – stay, no crash
      return res.json({ success: true, message: "Already at first video." });
    }

    const prev = videoRoom.videos[idx - 1];

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.fileName": prev.fileName,
          "video.controllerId": prev.uploadedBy,
          "video.currentVideoId": prev._id,
          "video.currentTime": 0,
          "video.isPlaying": true,
          "video.isPaused": false,
          "video.startedAt": new Date(),
        },
      }
    );

    // 1️⃣ Renegotiate
    io.to(`room:${roomId}`).emit("video:stream:ready", { from: userId });
    // 2️⃣ Track changed
    io.to(`room:${roomId}`).emit("video:trackChanged", {
      videoId: prev._id,
      fileName: prev.fileName,
      controllerId: prev.uploadedBy,
    });
    // 3️⃣ Play
    io.to(`room:${roomId}`).emit("video:play", {
      videoUrl: `/video-stream/${roomId}/${prev.fileName}`,
      currentTime: 0,
      startedAt: Date.now(),
      controllerId: prev.uploadedBy,
      fileName: prev.fileName,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ previousVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// SEEK (new) – absolute time
// ─────────────────────────────────────────────

exports.seekVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId, time } = req.body; // time in seconds

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.status(404).json({ error: "Room not found" });

    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    const duration = videoRoom.video?.duration || 0;
    const clamped = Math.max(0, Math.min(Number(time) || 0, duration || Infinity));

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.currentTime": clamped,
          "video.startedAt": new Date(),
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:positionChanged", {
      currentTime: clamped,
      controllerId: videoRoom.video.controllerId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ seekVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// FORWARD (new) – +10 seconds
// ─────────────────────────────────────────────

exports.forwardVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.status(404).json({ error: "Room not found" });

    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    const current = getCurrentVideoTime(videoRoom.video);
    const duration = videoRoom.video?.duration || 0;
    const newTime = duration > 0
      ? Math.min(current + 10, duration)
      : current + 10;

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.currentTime": newTime,
          "video.startedAt": new Date(),
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:positionChanged", {
      currentTime: newTime,
      controllerId: videoRoom.video.controllerId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ forwardVideo:", err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// REWIND (new) – -10 seconds
// ─────────────────────────────────────────────

exports.rewindVideo = async (req, res, io) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const videoRoom = await VideoRoom.findOne({ roomId });
    if (!videoRoom) return res.status(404).json({ error: "Room not found" });

    if (!canControlVideo(videoRoom, userId)) {
      return res.status(403).json({
        message: "Only uploader of this video can control playback.",
      });
    }

    const current = getCurrentVideoTime(videoRoom.video);
    const newTime = Math.max(current - 10, 0);

    await VideoRoom.updateOne(
      { roomId },
      {
        $set: {
          "video.currentTime": newTime,
          "video.startedAt": new Date(),
        },
      }
    );

    io.to(`room:${roomId}`).emit("video:positionChanged", {
      currentTime: newTime,
      controllerId: videoRoom.video.controllerId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ rewindVideo:", err);
    res.status(500).json({ error: err.message });
  }
};
