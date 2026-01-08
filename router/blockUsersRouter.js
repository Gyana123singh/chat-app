// routes/block.routes.js
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const blockUsersController = require("../controllers/blockUsers.controller");

router.post("/:userId", authMiddleware, blockUsersController.blockUser);
router.post(
  "/unblock/:userId",
  authMiddleware,
  blockUsersController.unblockUser
);
router.get("/block-list", authMiddleware, blockUsersController.getBlockList);

module.exports = ro;
