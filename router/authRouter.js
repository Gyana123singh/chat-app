const express = require("express");
const router = express.Router();
const passport = require("passport");
const authController = require("../controllers/authController");

// Middleware: ensure Google OAuth is configured before invoking passport
const ensureGoogleConfigured = (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn(
      "[GOOGLE OAUTH] Attempt to use Google auth but it's not configured on this server"
    );
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    return res.redirect(`${clientUrl}/Login?error=google_not_configured`);
  }
  return next();
};

// 1️⃣ Start Google Auth
router.get(
  "/google",
  ensureGoogleConfigured,
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account consent",
  })
);

// 2️⃣ Google Callback
router.get(
  "/google/callback",
  ensureGoogleConfigured,
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/failed",
  }),
  authController.googleAuthSuccess
);

// router.post("/register", authController.register);
// router.post("/login", authController.login);
// router.post("/logout", authMiddleware, authController.logout);
// router.post("/refresh-token", authMiddleware, authController.refreshToken);
module.exports = router;
