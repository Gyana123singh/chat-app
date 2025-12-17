// routes/users.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const userPhoneOtpAuth = require("../controllers/authController");
const { authMiddleware } = require("../middleware/auth");

router.get("/profile", authMiddleware, userController.getProfile);
router.put("/profile", authMiddleware, userController.updateProfile);
router.get("/:id", userController.getUserById);
router.get("/search", userController.searchUsers);
router.post("/follow/:id", authMiddleware, userController.followUser);
router.get("/followers", authMiddleware, userController.getFollowers);
router.get("/following", authMiddleware, userController.getFollowing);

module.exports = router;
