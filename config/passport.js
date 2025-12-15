const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/Users");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://chat-app-1-qvl9.onrender.com/auth/google/callback", // use relative path
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({
          $or: [{ googleId: profile.id }, { email: profile.emails[0].value }],
        });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails[0].value,
            username: profile.displayName.replace(/\s+/g, "").toLowerCase(),
            isVerified: true,

            profile: {
              avatar: profile.photos?.[0]?.value, // ✅ Google profile picture
            },
          });
        } else {
          // 🔄 Update avatar if missing
          if (!user.profile.avatar && profile.photos?.[0]?.value) {
            user.profile.avatar = profile.photos[0].value;
            await user.save();
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
