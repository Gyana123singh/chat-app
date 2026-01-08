// models/ProfileVisit.model.js
const mongoose = require("mongoose");

const profileVisitSchema = new mongoose.Schema(
  {
    profileOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    visitor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    visitedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Prevent spam visits (1 visit per day per user)
profileVisitSchema.index(
  { profileOwner: 1, visitor: 1, visitedAt: 1 },
  { unique: false }
);

module.exports = mongoose.model("ProfileVisit", profileVisitSchema);
