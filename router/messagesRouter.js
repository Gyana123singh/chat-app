// // routes/messages.js
// const express = require('express');
// const router = express.Router();
// const messageController = require('../controllers/messageController');
// const { authMiddleware } = require('../middleware/auth');

// router.get('/:roomId', messageController.getMessages);
// router.post('/', authMiddleware, messageController.sendMessage);
// router.delete('/:messageId', authMiddleware, messageController.deleteMessage);

// module.exports = router;