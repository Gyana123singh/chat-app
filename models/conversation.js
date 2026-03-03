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
    participantsHash: {
      type: String,
      unique: true, // 🔥 prevents duplicate 1-to-1 chats
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PrivateMessage",
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
  { timestamps: true },
);

// Sort participants before save
conversationSchema.pre("validate", function (next) {
  if (this.participants.length === 2) {
    const sorted = this.participants.map((id) => id.toString()).sort();
    this.participantsHash = sorted.join("_");
  }
  next();
});

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageTime: -1 });
// Faster conversation lookup
conversationSchema.index({ participantsHash: 1, isActive: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
