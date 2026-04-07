// models/message.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ FIXED (STRING)
    room: {
      type: String,
      required: true,
    },

    messageType: {
      type: String,
      enum: ["text", "gift", "system"],
      default: "text",
    },

    metadata: {
      type: Object,
      default: {},
    },

    isDeletedForEveryone: {
      type: Boolean,
      default: false,
    },

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

messageSchema.index({ room: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);