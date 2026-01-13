const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");

// ✅ Middleware to verify authentication (adjust based on your auth system)

// ===========================
// CONVERSATION ENDPOINTS
// ===========================

//  ✅ GET all conversations for a user

exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true,
    })
      .populate("participants", "id username avatar email")
      .populate({
        path: "lastMessage",
        select: "text createdAt sender",
      })
      .sort({ lastMessageTime: -1 });

    res.status(200).json({
      success: true,
      count: conversations.length,
      data: conversations,
    });
  } catch (error) {
    console.error("❌ Error fetching conversations:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch conversations",
      message: error.message,
    });
  }
};

//  * ✅ GET single conversation by ID

exports.getConversationById = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId)
      .populate("participants", "id username avatar email")
      .populate("lastMessage");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    // ✅ Verify user is participant
    if (!conversation.participants.some((p) => p._id.toString() === userId)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to this conversation",
      });
    }

    res.status(200).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error("❌ Error fetching conversation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch conversation",
      message: error.message,
    });
  }
};

//  * ✅ GET or CREATE conversation between two users

exports.getOrCreateConversation = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const otherUserId = req.params.userId;

    if (currentUserId === otherUserId) {
      return res.status(400).json({
        success: false,
        error: "Cannot chat with yourself",
      });
    }

    // ✅ Find existing conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUserId, otherUserId] },
      isActive: true,
    }).populate("participants", "id username avatar email");

    // ✅ Create new conversation if doesn't exist
    if (!conversation) {
      conversation = new Conversation({
        participants: [currentUserId, otherUserId],
        lastMessage: null,
        lastMessageTime: null,
      });
      await conversation.save();
      conversation = await conversation.populate(
        "participants",
        "id username avatar email"
      );

      console.log(
        `✅ New conversation created: ${currentUserId} <-> ${otherUserId}`
      );
    }

    res.status(200).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error("❌ Error creating/fetching conversation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create/fetch conversation",
      message: error.message,
    });
  }
};

// ===========================
// MESSAGE ENDPOINTS
// ===========================

//  * ✅ GET messages for a conversation with pagination

exports.getMessagesForConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // ✅ Verify user is participant of conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    const userId = req.user.id;
    if (!conversation.participants.some((p) => p.toString() === userId)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to this conversation",
      });
    }

    const messages = await Message.find({ conversationId })
      .populate("sender", "id username avatar")
      .populate("recipient", "id username avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Message.countDocuments({ conversationId });

    res.status(200).json({
      success: true,
      data: {
        messages: messages.reverse(), // Return in chronological order
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error fetching messages:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages",
      message: error.message,
    });
  }
};

//  * ✅ SEND message via REST API

exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, recipientId, text, attachment } = req.body;
    const senderId = req.user.id;

    // ✅ Validation
    if (!conversationId || !recipientId || !text) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: conversationId, recipientId, text",
      });
    }

    if (text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message text cannot be empty",
      });
    }

    if (text.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Message text cannot exceed 1000 characters",
      });
    }

    // ✅ Verify conversation exists and user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    if (!conversation.participants.some((p) => p.toString() === senderId)) {
      return res.status(403).json({
        success: false,
        error: "You are not a participant of this conversation",
      });
    }

    // ✅ Create message
    const message = new Message({
      conversationId,
      sender: senderId,
      recipient: recipientId,
      text: text.trim(),
      attachment: attachment || null,
    });

    await message.save();
    await message.populate("sender", "id username avatar");
    await message.populate("recipient", "id username avatar");

    // ✅ Update conversation's lastMessage
    await conversation.updateLastMessage(message._id);

    console.log(`💬 Message sent: ${senderId} -> ${recipientId}`);

    res.status(201).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send message",
      message: error.message,
    });
  }
};

//  * ✅ EDIT message

exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required",
      });
    }

    if (text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message text cannot be empty",
      });
    }

    if (text.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Message text cannot exceed 1000 characters",
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    // ✅ Verify ownership
    if (message.sender.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: "You can only edit your own messages",
      });
    }

    // ✅ Edit message
    await message.editText(text.trim());
    await message.populate("sender", "id username avatar");
    await message.populate("recipient", "id username avatar");

    console.log(`✏️ Message ${messageId} edited by ${userId}`);

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error("❌ Error editing message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to edit message",
      message: error.message,
    });
  }
};

//  * ✅ DELETE message

exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    // ✅ Verify ownership
    if (message.sender.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: "You can only delete your own messages",
      });
    }

    await Message.findByIdAndDelete(messageId);

    console.log(`🗑️ Message ${messageId} deleted by ${userId}`);

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
      data: { messageId },
    });
  } catch (error) {
    console.error("❌ Error deleting message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete message",
      message: error.message,
    });
  }
};

//  * ✅ MARK message as read

exports.markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    // ✅ Mark as read
    await message.markAsRead();
    await message.populate("sender", "id username avatar");
    await message.populate("recipient", "id username avatar");

    console.log(`✅ Message ${messageId} marked as read`);

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error("❌ Error marking message as read:", error);
    res.status(500).json({
      success: false,
      error: "Failed to mark message as read",
      message: error.message,
    });
  }
};

//  * ✅ MARK all messages in a conversation as read

exports.markConversationAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // ✅ Update all unread messages for this user
    const result = await Message.updateMany(
      {
        conversationId,
        recipient: userId,
        isRead: false,
      },
      {
        isRead: true,
        readAt: new Date(),
      }
    );

    console.log(
      `✅ ${result.modifiedCount} messages marked as read in conversation`
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} messages marked as read`,
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("❌ Error marking conversation as read:", error);
    res.status(500).json({
      success: false,
      error: "Failed to mark conversation as read",
      message: error.message,
    });
  }
};

//  * ✅ DELETE conversation (soft delete - just mark as inactive)

exports.deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found",
      });
    }

    // ✅ Verify user is participant
    if (!conversation.participants.some((p) => p.toString() === userId)) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to this conversation",
      });
    }

    // ✅ Soft delete
    conversation.isActive = false;
    await conversation.save();

    console.log(`🗑️ Conversation ${conversationId} deleted by ${userId}`);

    res.status(200).json({
      success: true,
      message: "Conversation deleted successfully",
      data: { conversationId },
    });
  } catch (error) {
    console.error("❌ Error deleting conversation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete conversation",
      message: error.message,
    });
  }
};

//  * ✅ GET unread message count

exports.getUnreadMessageCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const unreadCount = await Message.countDocuments({
      recipient: userId,
      isRead: false,
    });

    // Get unread count per conversation
    const unreadByConversation = await Message.aggregate([
      {
        $match: {
          recipient: mongoose.Types.ObjectId(userId),
          isRead: false,
        },
      },
      {
        $group: {
          _id: "$conversationId",
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUnread: unreadCount,
        byConversation: unreadByConversation,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching unread count:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch unread count",
      message: error.message,
    });
  }
};
