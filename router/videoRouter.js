const express = require("express");
const videoController = require("../controllers/videoController");
const createVideoUpload = require("../middleware/videoUpload");

module.exports = (io) => {
  const router = express.Router();

  const upload = createVideoUpload();

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

  return router;
};