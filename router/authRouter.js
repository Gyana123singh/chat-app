const express = require("express");
const router = express.Router();
const passport = require("passport");
const authController = require("../controllers/authController");

// 1️⃣ Email and Password Auth Routes
router.post("/register", authController.register);
router.post("/login", authController.login);

// 2️⃣ Start Google Auth (Using prompt: "select_account" to skip the "Continue" consent screen after email selection)
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
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

// 4️⃣ Native Firebase Google Login (For Native Mobile Apps / APKs without browser redirect)
router.post("/google/firebase", authController.googleFirebaseLogin);

module.exports = router;
