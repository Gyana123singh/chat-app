const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");
const User = require("../models/users");
const mongoose = require("mongoose");

/* ===========================
   GET ALL CONVERSATIONS
=========================== */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true,
    })
      .populate("participants", "username profile.avatar email")
      .populate({
        path: "lastMessage",
        select: "text createdAt sender",
        populate: { path: "sender", select: "username profile.avatar" },
      })
      .sort({ lastMessageTime: -1 });

    res.status(200).json({
      success: true,
      count: conversations.length,
      data: conversations,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ===========================
   GET CONVERSATION BY ID
=========================== */
exports.getConversationById = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    const conversation = await Conversation.findById(conversationId)
      .populate("participants", "username profile.avatar email")
      .populate("lastMessage");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isParticipant = conversation.participants.some(
      (p) => p._id.toString() === userId.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ===========================
   GET OR CREATE CONVERSATION
=========================== */
exports.getOrCreateConversation = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const otherUserId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (currentUserId === otherUserId) {
      return res.status(400).json({
        success: false,
        message: "Cannot chat with yourself",
      });
    }

    const targetUser = await User.findById(otherUserId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const sorted = [currentUserId, otherUserId].sort();
    const hash = sorted.join("_");

    let conversation = await Conversation.findOne({
      participantsHash: hash,
      isActive: true,
    }).populate("participants", "username profile.avatar");

    if (!conversation) {
      conversation = await Conversation.create({
        participants: sorted,
        participantsHash: hash,
      });

      await conversation.populate("participants", "username profile.avatar");
    }

    return res.status(200).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error("❌ getOrCreateConversation error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/* ===========================
   SEND MESSAGE (SECURE VERSION)
=========================== */
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, recipientId, text, attachment } = req.body;
    const senderId = req.user.id;

    // ✅ Required fields (text OR attachment allowed)
    if (!conversationId || !recipientId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (!text && !attachment) {
      return res.status(400).json({
        success: false,
        message: "Message cannot be empty",
      });
    }

    // ✅ Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(conversationId) ||
      !mongoose.Types.ObjectId.isValid(recipientId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    // ✅ Fetch conversation
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // ✅ Ensure sender is participant
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === senderId.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // ✅ Ensure recipient belongs to this conversation
    const isRecipientValid = conversation.participants.some(
      (p) => p.toString() === recipientId.toString(),
    );

    if (!isRecipientValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid recipient",
      });
    }

    // ✅ Prevent sending to self
    if (recipientId.toString() === senderId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot send message to yourself",
      });
    }

    // ✅ Trim text safely
    const trimmedText = text ? text.trim() : "";

    if (trimmedText.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Message too long",
      });
    }

    // ✅ Create message
    const message = await Message.create({
      conversationId,
      sender: senderId,
      recipient: recipientId,
      text: trimmedText,
      attachment: attachment || null,
    });

    // ✅ Update conversation last message
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
      lastMessageTime: new Date(),
    });

    // ✅ Populate sender & recipient
    const populated = await message
      .populate("sender", "username profile.avatar")
      .populate("recipient", "username profile.avatar");

    return res.status(201).json({
      success: true,
      data: populated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ===========================
   MARK MESSAGE AS READ
=========================== */
exports.markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // 🔐 Only recipient can mark read
    if (message.recipient.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    message.isRead = true;
    message.readAt = new Date();
    await message.save();

    res.status(200).json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markConversationAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await Message.updateMany(
      { conversationId, recipient: userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    return res.status(200).json({
      success: true,
      message: "Conversation marked as read",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
/* ===========================
   GET MESSAGES (PAGINATED)
=========================== */
exports.getMessagesForConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { cursor } = req.query; // optional
    const userId = req.user.id;
    const limit = 50;

    // ✅ Validate ID
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    // ✅ Ensure conversation exists
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // 🔐 Ensure user is participant
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // ✅ Build query
    let query = { conversationId };

    if (cursor) {
      query._id = { $lt: cursor }; // load older messages
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 }) // newest first
      .limit(limit)
      .populate("sender", "username profile.avatar")
      .populate("recipient", "username profile.avatar");

    const nextCursor =
      messages.length === limit ? messages[messages.length - 1]._id : null;

    return res.status(200).json({
      success: true,
      data: messages,
      nextCursor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ===========================
   GET UNREAD COUNT
=========================== */
exports.getUnreadMessageCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const totalUnread = await Message.countDocuments({
      recipient: userId,
      isRead: false,
    });

    const byConversation = await Message.aggregate([
      {
        $match: {
          recipient: new mongoose.Types.ObjectId(userId),
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
      data: { totalUnread, byConversation },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Text required" });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });
    }

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    message.text = text.trim();
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    res.status(200).json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });
    }

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    await message.deleteOne();

    res.status(200).json({ success: true, message: "Message deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId.toString(),
    );

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    conversation.isActive = false;
    await conversation.save();

    res.status(200).json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
