const mongoose = require("mongoose");

const friendSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    friendId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
// 🔥 PERFORMANCE INDEXES
friendSchema.index({ userId: 1 });
friendSchema.index({ friendId: 1 });
// 🔥 PREVENT DUPLICATE FRIENDS (VERY IMPORTANT)
friendSchema.index({ userId: 1, friendId: 1 }, { unique: true });

module.exports = mongoose.model("Friend", friendSchema);
