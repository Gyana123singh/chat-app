// routes/rooms.js
const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const { authMiddleware } = require('../middleware/auth');

router.post('/create', authMiddleware, roomController.createRoom);
router.get('/', roomController.getAllRooms);
router.get('/popular', roomController.getPopularRooms);
router.get('/:id', roomController.getRoomById);
router.put('/:id', authMiddleware, roomController.updateRoom);
router.delete('/:id', authMiddleware, roomController.deleteRoom);
router.post('/:id/join', authMiddleware, roomController.joinRoom);
router.post('/:id/leave', authMiddleware, roomController.leaveRoom);

module.exports = router;