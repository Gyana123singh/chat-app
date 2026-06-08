const express = require("express");
const router = express.Router();
const passport = require("passport");
const authController = require("../controllers/authController");

// 1️⃣ Email and Password Auth Routes
router.post("/register", authController.register);
router.post("/login", authController.login);

// 2️⃣ Start Google Auth
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account consent",
  }),
);

// 3️⃣ Google Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.CLIENT_URL}/Login?error=google`,
  }),
  authController.googleAuthSuccess,
);

module.exports = router;
