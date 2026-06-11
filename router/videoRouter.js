const express = require("express");
const videoController = require("../controllers/videoController");
const createVideoUpload = require("../middleware/videoUpload");

module.exports = (io) => {
  const router = express.Router();

  const upload = createVideoUpload();

  // ─── EXISTING ROUTES (unchanged) ──────────────────────────────────────────
  router.post(
    "/upload/:roomId",
    upload.single("video"),
    (req, res) => {
      videoController.uploadVideo(req, res, io);
    }
  );

  router.post("/play/:roomId", (req, res) => {
    videoController.playVideo(req, res, io);
  });

  router.post("/pause/:roomId", (req, res) => {
    videoController.pauseVideo(req, res, io);
  });

  router.post("/resume/:roomId", (req, res) => {
    videoController.resumeVideo(req, res, io);
  });

  router.post("/stop/:roomId", (req, res) => {
    videoController.stopVideo(req, res, io);
  });

  router.get("/list/:roomId", (req, res) => {
    videoController.getVideoList(req, res);
  });

  // ─── NEW PLAYLIST CONTROL ROUTES ─────────────────────────────────────────
  // POST /api/video/select/:roomId   { userId, videoId }
  router.post("/select/:roomId", (req, res) => {
    videoController.selectVideo(req, res, io);
  });

  // POST /api/video/next/:roomId     { userId }
  router.post("/next/:roomId", (req, res) => {
    videoController.nextVideo(req, res, io);
  });

  // POST /api/video/previous/:roomId { userId }
  router.post("/previous/:roomId", (req, res) => {
    videoController.previousVideo(req, res, io);
  });

  // POST /api/video/seek/:roomId     { userId, time }
  router.post("/seek/:roomId", (req, res) => {
    videoController.seekVideo(req, res, io);
  });

  // POST /api/video/forward/:roomId  { userId }
  router.post("/forward/:roomId", (req, res) => {
    videoController.forwardVideo(req, res, io);
  });

  // POST /api/video/rewind/:roomId   { userId }
  router.post("/rewind/:roomId", (req, res) => {
    videoController.rewindVideo(req, res, io);
  });

  return router;
};