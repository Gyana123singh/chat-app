const express = require("express");

const router = express.Router();

const { getForYouInvites } = require("../controllers/roomInviteController");
const { authMiddleware } = require("../middleware/auth");
router.get("/invites", authMiddleware, getForYouInvites);

module.exports = router;
