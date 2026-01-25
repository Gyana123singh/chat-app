const mongoose = require("mongoose");

const cpHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    amount: Number,

    source: {
      type: String,
      enum: [
        "JOIN_ROOM",
        "STAY_5_MIN",
        "HOST_10_MIN",
        "SEND_GIFT",
        "PK",
        "ADMIN",
        "CLAIM", // ✅ ADD THIS
      ],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CPHistory", cpHistorySchema);
