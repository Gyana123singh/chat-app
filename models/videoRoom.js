// models/VideoRoom.js
const mongoose = require("mongoose");

const videoRoomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    video: {
      isPlaying: { type: Boolean, default: false },
      isPaused: { type: Boolean, default: false },
      currentTime: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
      fileName: { type: String, default: null },
      fileSize: { type: Number, default: 0 },
      mimeType: { type: String, default: "video/mp4" },
      isVisible: { type: Boolean, default: false },
      startedAt: { type: Date, default: null },
      pausedAt: { type: Date, default: null },
      lastSyncTime: { type: Date, default: Date.now },
    },
    audio: {
      videoAudioVolume: { type: Number, default: 1.0, min: 0, max: 1 },
      hostMicVolume: { type: Number, default: 1.0, min: 0, max: 1 },
      isMixing: { type: Boolean, default: false },
    },
    frameSync: {
      lastFrameNumber: { type: Number, default: 0 },
      expectedFPS: { type: Number, default: 30 },
      frameTimestamps: [{
        frameNumber: Number,
        capturedAt: Date,
        sentAt: Date,
        latency: Number,
      }],
    },
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participants: [{
      userId: mongoose.Schema.Types.ObjectId,
      role: { type: String, enum: ["host", "listener"] },
      isReceivingVideo: { type: Boolean, default: false },
      lastVideoFrameReceived: { type: Number, default: 0 },
      videoFPS: { type: Number, default: 0 },
      videoLatency: { type: Number, default: 0 },
    }],
    stats: {
      totalFramesSent: { type: Number, default: 0 },
      totalFramesReceived: { type: Number, default: 0 },
      averageFrameSize: { type: Number, default: 0 },
      droppedFrames: { type: Number, default: 0 },
      totalBandwidthUsed: { type: Number, default: 0 },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

videoRoomSchema.index({ roomId: 1 });
videoRoomSchema.index({ hostId: 1, "video.isPlaying": 1 });

module.exports = mongoose.model("VideoRoom", videoRoomSchema);
