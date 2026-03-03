const mongoose = require("mongoose");

const friendRequestSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

// ✅ Prevent duplicate friend requests (DB level protection)
friendRequestSchema.index({ from: 1, to: 1 }, { unique: true });

// Optional: Faster lookup
friendRequestSchema.index({ to: 1, status: 1 });

module.exports = mongoose.model("FriendRequest", friendRequestSchema);
