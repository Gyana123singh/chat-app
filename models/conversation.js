const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    lastMessageTime: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// ✅ Index for finding conversations between two users
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageTime: -1 });

// ✅ Static method to get or create conversation between two users
conversationSchema.statics.getOrCreateConversation = async function (
  userId1,
  userId2
) {
  if (userId1 === userId2) {
    throw new Error("Cannot create conversation with yourself");
  }

  let conversation = await this.findOne({
    participants: { $all: [userId1, userId2] },
    isActive: true,
  });

  if (!conversation) {
    conversation = new this({
      participants: [userId1, userId2],
      lastMessage: null,
      lastMessageTime: null,
    });
    await conversation.save();
  }

  return conversation;
};

// ✅ Instance method to add message reference
conversationSchema.methods.updateLastMessage = async function (messageId) {
  this.lastMessage = messageId;
  this.lastMessageTime = new Date();
  await this.save();
  return this;
};

module.exports = mongoose.model("Conversation", conversationSchema);
