// routes/block.routes.js
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const blockUsersController = require("../controllers/blockUsers.controller");

router.post("/block", authMiddleware, blockUsersController.blockUser);
router.post("/unblock", authMiddleware, blockUsersController.unblockUser);
router.get("/list", authMiddleware, blockUsersController.getBlockList);

module.exports = router;
