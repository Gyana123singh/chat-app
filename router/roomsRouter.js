// routes/rooms.js
const express = require("express");
const router = express.Router();
const roomController = require("../controllers/roomController");
const { authMiddleware } = require("../middleware/auth");

router.get("/user/:id", authMiddleware, roomController.getMyRooms);  //done get data user by id
router.post("/create", authMiddleware, roomController.createRoom);  //done create room
router.get("/get-all-rooms", roomController.getAllRooms); //done get all rooms with pagination, search, filter
router.get("/popular", roomController.getPopularRooms);
router.put("/:id", authMiddleware, roomController.updateRoom);
router.delete("/:id", authMiddleware, roomController.deleteRoom);
router.post("/:id/join", authMiddleware, roomController.joinRoom);
router.post("/:id/leave", authMiddleware, roomController.leaveRoom);

module.exports = router;
