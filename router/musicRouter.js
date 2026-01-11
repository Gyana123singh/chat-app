const express = require("express");
const router = express.Router();

const musicController = require("../controllers/musicController");

// Play music in a room
router.post("/:roomId/play", musicController.playMusic);
// Pause music in a room
router.post("/:roomId/pause", musicController.pauseMusic);
// Resume music in a room
router.post("/:roomId/resume", musicController.resumeMusic);
// Get current music state in a room
router.get("/:roomId/state", musicController.getMusicState);

router.post("/:roomId/stop", musicController.stopMusic);

module.exports = router;
