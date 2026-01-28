const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/users");
const { handleGoogleAuth } = require("../utils/googleAuthService");

// ✅ REQUIRED
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://api.dilvoicechat.fun/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await handleGoogleAuth(profile);
        return done(null, user); // ✅ MUST BE USER
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
