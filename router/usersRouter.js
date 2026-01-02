// routes/users.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const userPhoneOtpAuth = require("../controllers/authController");
const { authMiddleware } = require("../middleware/auth");

router.get("/profile/:userId", authMiddleware, userController.getUserById);
router.put("/edit-profile/:userId", authMiddleware, userController.updateProfile);
router.get("/:id", userController.getProfile);
router.get("/search", userController.searchUsers);
router.post("/follow/:id", authMiddleware, userController.followUser);
router.get("/followers", authMiddleware, userController.getFollowers);
router.get("/following", authMiddleware, userController.getFollowing);

module.exports = router;
