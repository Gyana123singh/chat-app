// routes/rooms.js
const express = require("express");
const router = express.Router();
const roomController = require("../controllers/roomController");
const { authMiddleware } = require("../middleware/auth");

router.get("/get-all-rooms", roomController.getAllRooms); //done get all rooms with pagination, search, filter
router.get("/my-rooms", authMiddleware, roomController.getMyRooms);
router.get("/:roomId", authMiddleware, roomController.getRoomById); //done get data user by id
router.post("/create", authMiddleware, roomController.createRoom); //done create room
router.put("/:id", authMiddleware, roomController.updateRoom);
router.delete("/:id", authMiddleware, roomController.deleteRoom);
router.post("/:roomId/join", authMiddleware, roomController.joinRoom);
router.post("/:roomId/leave", authMiddleware, roomController.leaveRoom);
router.get("get-popular-rooms", roomController.getPopularRooms);

// 🎬 VIDEO ENDPOINTS (NEW)
router.get(
  "/:roomId/video/stats",
  authMiddleware,
  roomController.getVideoStats
);
router.post(
  "/:roomId/video/frame-stats",
  authMiddleware,
  roomController.updateFrameStats
);

router.post(
  "/:roomId/video/listener-status",
  authMiddleware,
  roomController.updateListenerVideoStatus
);

router.post(
  "/:roomId/video/session",
  authMiddleware,
  roomController.recordVideoSession
);
router.get(
  "/:roomId/video/quality-metrics",
  authMiddleware,
  roomController.getVideoQualityMetrics
);

module.exports = router;
