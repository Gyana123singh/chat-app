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
      const dir = path.join(__dirname, "", roomId);
      await fs.ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  const upload = multer({ storage });

  router.post("/upload/:roomId", upload.single("music"), (req, res) =>
    musicController.uploadAndPlayMusic(req, res, io)
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
