const Message = require("../models/privateMessage");
const Conversation = require("../models/conversation");
const mongoose = require("mongoose");

// ===========================
// GET ALL CONVERSATIONS
// ===========================
exports.getConversations = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log("📥 getConversations for user:", userId.toString());

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true,
    })
      .populate("participants", "username avatar email")
      .populate({
        path: "lastMessage",
        select: "text createdAt sender",
        populate: { path: "sender", select: "username avatar" },
      })
      .sort({ lastMessageTime: -1 });

    console.log("✅ Conversations found:", conversations.length);

    res.status(200).json({
      success: true,
      count: conversations.length,
      data: conversations,
    });
  } catch (error) {
    console.error("❌ getConversations error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// GET CONVERSATION BY ID
// ===========================
exports.getConversationById = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log(
      "📥 getConversationById:",
      conversationId,
      "user:",
      userId.toString()
    );

    const conversation = await Conversation.findById(conversationId)
      .populate("participants", "username avatar email")
      .populate("lastMessage");

    if (!conversation) {
      console.log("❌ Conversation not found");
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some((p) =>
      p.equals(userId)
    );

    console.log("🔎 isParticipant:", isParticipant);

    if (!isParticipant) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized access" });
    }

    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    console.error("❌ getConversationById error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// GET OR CREATE CONVERSATION
// ===========================
exports.getOrCreateConversation = async (req, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.user.id);
    const otherUserId = new mongoose.Types.ObjectId(req.params.userId);

    console.log(
      "📥 getOrCreateConversation:",
      currentUserId.toString(),
      otherUserId.toString()
    );

    if (currentUserId.equals(otherUserId)) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot chat with yourself" });
    }

    let conversation = await Conversation.findOne({
      participants: { $all: [currentUserId, otherUserId] },
      isActive: true,
    }).populate("participants", "username avatar email");

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [currentUserId, otherUserId],
      });

      conversation = await conversation.populate(
        "participants",
        "username avatar email"
      );

      console.log("✅ New conversation created:", conversation._id.toString());
    } else {
      console.log(
        "✅ Existing conversation found:",
        conversation._id.toString()
      );
    }

    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    console.error("❌ getOrCreateConversation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// GET MESSAGES (🔥 MAIN FIX HERE)
// ===========================
exports.getMessagesForConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log(
      "📥 getMessagesForConversation:",
      conversationId,
      "user:",
      userId.toString()
    );

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      console.log("❌ Conversation not found");
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some((p) =>
      p.equals(userId)
    );

    console.log("🔎 isParticipant:", isParticipant);

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const messages = await Message.find({ conversationId })
      .populate("sender", "username avatar")
      .populate("recipient", "username avatar")
      .sort({ createdAt: 1 }); // 🔥 FIX: oldest → newest (NO reverse)

    console.log("✅ Messages fetched:", messages.length);

    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error("❌ getMessagesForConversation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// SEND MESSAGE (REST)
// ===========================
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, recipientId, text, attachment } = req.body;
    const senderId = new mongoose.Types.ObjectId(req.user.id);

    console.log("📤 sendMessage:", {
      conversationId,
      senderId: senderId.toString(),
      recipientId,
    });

    if (!conversationId || !recipientId || !text) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const message = await Message.create({
      conversationId,
      sender: senderId,
      recipient: recipientId,
      text: text.trim(),
      attachment: attachment || null,
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
      lastMessageTime: new Date(),
    });

    const populated = await message.populate("sender", "username avatar");

    console.log("✅ Message saved:", message._id.toString());

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error("❌ sendMessage error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// EDIT MESSAGE
// ===========================
exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log("✏️ editMessage:", messageId, "by", userId.toString());

    const message = await Message.findById(messageId);

    if (!message)
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });

    if (!message.sender.equals(userId)) {
      return res
        .status(403)
        .json({ success: false, message: "Not your message" });
    }

    await message.editText(text.trim());

    res.status(200).json({ success: true, data: message });
  } catch (error) {
    console.error("❌ editMessage error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// DELETE MESSAGE
// ===========================
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log("🗑 deleteMessage:", messageId, "by", userId.toString());

    const message = await Message.findById(messageId);

    if (!message)
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });

    if (!message.sender.equals(userId)) {
      return res
        .status(403)
        .json({ success: false, message: "Not your message" });
    }

    await Message.findByIdAndDelete(messageId);

    res
      .status(200)
      .json({ success: true, message: "Message deleted", data: { messageId } });
  } catch (error) {
    console.error("❌ deleteMessage error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// MARK MESSAGE AS READ
// ===========================
exports.markMessageAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;

    console.log("👁 markMessageAsRead:", messageId);

    const message = await Message.findById(messageId);

    if (!message)
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });

    await message.markAsRead();

    res.status(200).json({ success: true, data: message });
  } catch (error) {
    console.error("❌ markMessageAsRead error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// MARK ALL AS READ
// ===========================
exports.markConversationAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log(
      "👁 markConversationAsRead:",
      conversationId,
      "user:",
      userId.toString()
    );

    const result = await Message.updateMany(
      { conversationId, recipient: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.status(200).json({
      success: true,
      message: "All messages marked as read",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("❌ markConversationAsRead error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// DELETE CONVERSATION (SOFT)
// ===========================
exports.deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log(
      "🗑 deleteConversation:",
      conversationId,
      "user:",
      userId.toString()
    );

    const conversation = await Conversation.findById(conversationId);

    if (!conversation)
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });

    const isParticipant = conversation.participants.some((p) =>
      p.equals(userId)
    );

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    conversation.isActive = false;
    await conversation.save();

    res
      .status(200)
      .json({
        success: true,
        message: "Conversation deleted",
        data: { conversationId },
      });
  } catch (error) {
    console.error("❌ deleteConversation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ===========================
// GET UNREAD COUNT
// ===========================
exports.getUnreadMessageCount = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    console.log("📊 getUnreadMessageCount for:", userId.toString());

    const totalUnread = await Message.countDocuments({
      recipient: userId,
      isRead: false,
    });

    const byConversation = await Message.aggregate([
      { $match: { recipient: userId, isRead: false } },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      success: true,
      data: { totalUnread, byConversation },
    });
  } catch (error) {
    console.error("❌ getUnreadMessageCount error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
