// models/Popup.js
const mongoose = require("mongoose");

const popupSchema = new mongoose.Schema(
  {
    title: String,
    content: String,

    shownTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Popup", popupSchema);
