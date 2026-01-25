const express = require("express");
const router = require("express").Router();
const { authMiddleware } = require("../middleware/auth");
const sendFriendRequest = require("../controllers/sendFriendRequest");

router.post("/request", authMiddleware, sendFriendRequest.sendRequest);
router.post("/accept", authMiddleware, sendFriendRequest.acceptRequest);
router.post("/reject", authMiddleware, sendFriendRequest.rejectRequest);
router.get("/requests", authMiddleware, sendFriendRequest.getRequests);
router.get("/list", authMiddleware, sendFriendRequest.getFriends);
router.get(
  "/suggestions",
  authMiddleware,
  sendFriendRequest.getFriendSuggestions,
);

module.exports = router;
