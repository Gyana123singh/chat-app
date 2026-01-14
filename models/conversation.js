// models/conversation.js
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

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageTime: -1 });

conversationSchema.methods.updateLastMessage = async function (messageId) {
  this.lastMessage = messageId;
  this.lastMessageTime = new Date();
  await this.save();
  return this;
};

module.exports = mongoose.model("Conversation", conversationSchema);
