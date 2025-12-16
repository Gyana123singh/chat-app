const express = require("express");
const router = express.Router();
const passport = require("passport");
const authController = require("../controllers/authController");

// 1️⃣ Start Google Auth
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account consent",
  })
);

// 2️⃣ Google Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "https://chat-app-admin-dashboard-b3ut.vercel.app/login?error=google",
  }),
  authController.googleAuthSuccess
);

// router.post("/register", authController.register);
// router.post("/login", authController.login);
// router.post("/logout", authMiddleware, authController.logout);
// router.post("/refresh-token", authMiddleware, authController.refreshToken);
module.exports = router;
