// routes/rooms.js
const express = require("express");
const router = express.Router();
const roomController = require("../controllers/roomController");
const { authMiddleware } = require("../middleware/auth");


router.get("/get-all-rooms", roomController.getAllRooms); //done get all rooms with pagination, search, filter
router.get("/my-rooms", authMiddleware, roomController.getMyRooms);
router.get("/:roomId", authMiddleware, roomController.getRoomById); //done get data user by id
router.post("/create", authMiddleware, roomController.createRoom); //done create room
router.get("/popular", roomController.getPopularRooms);
router.put("/:id", authMiddleware, roomController.updateRoom);
router.delete("/:id", authMiddleware, roomController.deleteRoom);
router.post("/:roomId/join", authMiddleware, roomController.joinRoom);
router.post("/:roomId/leave", authMiddleware, roomController.leaveRoom);

module.exports = router;
