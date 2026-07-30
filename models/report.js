const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reporterName: {
      type: String,
      default: "Anonymous",
    },
    type: {
      type: String,
      enum: ["chat", "call", "room", "gift", "user"],
      default: "chat",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    details: {
      type: String,
      default: "",
    },
    targetId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "dismissed"],
      default: "pending",
    },
    actionTaken: {
      type: String,
      enum: ["none", "banned", "warning", "deleted"],
      default: "none",
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

reportSchema.index({ createdAt: -1 });
reportSchema.index({ status: 1 });
reportSchema.index({ type: 1 });

module.exports = mongoose.model("Report", reportSchema);
