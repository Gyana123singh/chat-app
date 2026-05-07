const mongoose = require("mongoose");

const roomInviteSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      index: true,
    },

    roomTitle: String,
    roomImage: String,

    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    hostName: String,
    hostAvatar: String,

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    invitedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    type: {
      type: String,
      enum: ["friend", "public"],
      default: "friend",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 1000 * 60 * 60),
    },
  },
  { timestamps: true },
);

roomInviteSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);

module.exports = mongoose.model("RoomInvite", roomInviteSchema);