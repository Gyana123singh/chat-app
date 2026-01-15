const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const videoController = require("../controllers/videoController");

module.exports = (io) => {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const { roomId } = req.params;
     const dir = path.resolve(process.cwd(), "uploads", "videos", roomId);
      await fs.ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, ""));
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith("video/")) {
        return cb(new Error("Only video files are allowed"));
      }
      cb(null, true);
    },
  });

  // ✅ ALL USERS CAN UPLOAD
  router.post("/upload/:roomId", upload.single("video"), (req, res) =>
    videoController.uploadAndPlayVideo(req, res, io)
  );

  router.get("/list/:roomId", videoController.getVideoList);

  router.post("/pause/:roomId", (req, res) =>
    videoController.pauseVideo(req, res, io)
  );

  router.post("/resume/:roomId", (req, res) =>
    videoController.resumeVideo(req, res, io)
  );

  router.post("/stop/:roomId", (req, res) =>
    videoController.stopVideo(req, res, io)
  );

  return router;
};
