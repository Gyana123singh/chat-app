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
  }),
);

// 2️⃣ Google Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.CLIENT_URL}/Login?error=google`,
  }),
  authController.googleAuthSuccess,
);

module.exports = router;
