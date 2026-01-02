





// // controllers/messageController.js
// const Message = require('../models/Message');
// const Room = require('../models/Room');

// exports.getMessages = async (req, res) => {
//   try {
//     const { roomId } = req.params;
//     const { page = 1, limit = 50 } = req.query;

//     const room = await Room.findById(roomId);

//     if (!room) {
//       return res.status(404).json({
//         success: false,
//         message: 'Room not found',
//       });
//     }

//     const skip = (page - 1) * limit;

//     const messages = await Message.find({ room: roomId, isDeleted: false })
//       .populate('sender', 'username profile.avatar')
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await Message.countDocuments({
//       room: roomId,
//       isDeleted: false,
//     });

//     res.status(200).json({
//       success: true,
//       messages: messages.reverse(),
//       pagination: {
//         total,
//         page: parseInt(page),
//         pages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch messages',
//       error: error.message,
//     });
//   }
// };

// exports.sendMessage = async (req, res) => {
//   try {
//     const { roomId, content } = req.body;

//     if (!content || !roomId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Content and room ID are required',
//       });
//     }

//     const room = await Room.findById(roomId);

//     if (!room) {
//       return res.status(404).json({
//         success: false,
//         message: 'Room not found',
//       });
//     }

//     const message = new Message({
//       content,
//       sender: req.user.id,
//       room: roomId,
//       messageType: 'text',
//     });

//     await message.save();
//     await message.populate('sender', 'username profile.avatar');

//     res.status(201).json({
//       success: true,
//       message: message,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to send message',
//       error: error.message,
//     });
//   }
// };

// exports.deleteMessage = async (req, res) => {
//   try {
//     const { messageId } = req.params;

//     const message = await Message.findById(messageId);

//     if (!message) {
//       return res.status(404).json({
//         success: false,
//         message: 'Message not found',
//       });
//     }

//     if (message.sender.toString() !== req.user.id) {
//       return res.status(403).json({
//         success: false,
//         message: 'You can only delete your own messages',
//       });
//     }

//     message.isDeleted = true;
//     await message.save();

//     res.status(200).json({
//       success: true,
//       message: 'Message deleted successfully',
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete message',
//       error: error.message,
//     });
//   }
// };
