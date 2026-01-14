const express = require("express");
const router = express.Router();
const multer = require("multer");
const musicController = require("../controllers/musicController");
const path = require("path");

// ✅ File upload storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const roomDir = path.join(__dirname, "..", "uploads", req.params.roomId);
    cb(null, roomDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only audio files allowed"), false);
  },
});

module.exports = (io) => {
  // ✅ WRAP IN FUNCTION TO ACCEPT io

  router.post(
    "/:roomId/play",
    (req, res) => musicController.playMusic(req, res, io) // ✅ PASS io
  );

  router.post(
    "/:roomId/pause",
    (req, res) => musicController.pauseMusic(req, res, io) // ✅ PASS io
  );

  router.post(
    "/:roomId/resume",
    (req, res) => musicController.resumeMusic(req, res, io) // ✅ PASS io
  );

  router.post(
    "/:roomId/stop",
    (req, res) => musicController.stopMusic(req, res, io) // ✅ PASS io
  );

  router.get("/:roomId/state", musicController.getMusicState);

  return router; // ✅ RETURN ROUTER
};
