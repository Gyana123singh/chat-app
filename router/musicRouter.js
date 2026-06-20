const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const musicController = require("../controllers/musicController");

module.exports = (io) => {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const { roomId } = req.params;

        // 🔥 ALWAYS point to root /uploads
        // const dir = path.join(__dirname, "..", "..", "uploads", roomId);
        // ✅ FIXED – Render safe, no conflict with video
        const dir = path.resolve(process.cwd(), "uploads", roomId);

        await fs.ensureDir(dir);
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB
    },
  });

  router.post(
    "/upload/:roomId",
    upload.single("music"),
    musicController.uploadMusic,
  );
  // ▶️ PLAY MUSIC (USER ACTION REQUIRED)
  router.post("/play/:roomId", musicController.playMusic);

  router.get("/list/:roomId", musicController.getRoomMusicList);
  router.delete(
    "/delete/:roomId/:musicId",
    musicController.deleteRoomMusicList,
  );

  router.post("/clear/:roomId", musicController.clearQueue);

  router.post("/pause/:roomId", musicController.pauseMusic);

  router.post("/resume/:roomId", musicController.resumeMusic);

  router.post("/stop/:roomId", musicController.stopMusic);

  router.post("/select/:roomId/:musicId", musicController.selectTrack);

  router.post("/next/:roomId", musicController.nextTrack);

  router.post("/previous/:roomId", musicController.previousTrack);

  router.post("/seek/:roomId", musicController.seekMusic);

  router.post("/forward/:roomId", musicController.forwardMusic);

  router.post("/rewind/:roomId", musicController.rewindMusic);

  router.get("/state/:roomId", musicController.getMusicState);

  return router;
};
