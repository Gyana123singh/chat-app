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

  const upload = multer({ storage });

  router.post("/upload/:roomId", upload.single("music"), (req, res) =>
    musicController.uploadMusic(req, res, io)
  );
  // ▶️ PLAY MUSIC (USER ACTION REQUIRED)
  router.post("/play/:roomId", (req, res) =>
    musicController.playMusic(req, res, io)
  );
  router.get("/list/:roomId", musicController.getRoomMusicList);
  router.delete(
    "/delete/:roomId/:musicId",
    musicController.deleteRoomMusicList
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

  router.get("/state/:roomId", musicController.getMusicState);

  return router;
};
