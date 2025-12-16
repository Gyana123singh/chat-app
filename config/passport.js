const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/users");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://chat-app-1-qvl9.onrender.com/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;

        let user = await User.findOne({
          $or: [{ googleId: profile.id }, { email }],
        });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email,
            username: email.split("@")[0], // ✅ UNIQUE & SAFE
            isVerified: true,
            avatar: profile.photos?.[0]?.value || "",
            authProvider: "google",
          });
        } else {
          if (!user.avatar && profile.photos?.[0]?.value) {
            user.avatar = profile.photos[0].value;
            await user.save();
          }
        }

        return done(null, user);
      } catch (err) {
        console.error("Google Auth Error:", err);
        return done(null, false); // ❌ DO NOT crash server
      }
    }
  )
);

module.exports = passport;
