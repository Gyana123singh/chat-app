const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const musicController = require("../controllers/musicController");

module.exports = (io) => {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const { roomId } = req.params;
      const dir = path.resolve(process.cwd(), "uploads", roomId);
      await fs.ensureDir(dir);
      cb(null, dir);
    },

    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  const upload = multer({
    storage,

    // ✅ FINAL FIX — OPUS BLOCKED
    fileFilter: (req, file, cb) => {
      const allowedExt = [".mp3", ".m4a", ".aac", ".wav"];
      const ext = path.extname(file.originalname).toLowerCase();

      if (!allowedExt.includes(ext)) {
        return cb(
          new Error("Only MP3 / M4A / AAC / WAV audio allowed")
        );
      }

      cb(null, true);
    },

    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
    },
  });

  router.post("/upload/:roomId", upload.single("music"), (req, res) =>
    musicController.uploadMusic(req, res, io)
  );

  router.post("/play/:roomId", (req, res) =>
    musicController.playMusic(req, res, io)
  );

  router.post("/pause/:roomId", (req, res) =>
    musicController.pauseMusic(req, res, io)
  );

  router.post("/resume/:roomId", (req, res) =>
    musicController.resumeMusic(req, res, io)
  );

  router.post("/stop/:roomId", (req, res) =>
    musicController.stopMusic(req, res, io)
  );

  router.get("/list/:roomId", musicController.getRoomMusicList);
  router.get("/state/:roomId", musicController.getMusicState);
  router.delete(
    "/delete/:roomId/:musicId",
    musicController.deleteRoomMusicList
  );

  return router;
};
