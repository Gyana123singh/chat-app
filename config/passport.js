const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/users");

// ================= GOOGLE STRATEGY =================
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://chat-app-1-qvl9.onrender.com/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(null, false);

        let user = await User.findOne({
          $or: [{ googleId: profile.id }, { email }],
        });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email,
            username: email.split("@")[0] + "_" + profile.id.slice(-5),
            isVerified: true,
            profile: {
              avatar: profile.photos?.[0]?.value,
            },
          });
        }

        return done(null, user);
      } catch (error) {
        console.error("❌ GOOGLE STRATEGY ERROR:", error);
        return done(error, null);
      }
    }
  )
);

// ================= SERIALIZE USER =================
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// ================= DESERIALIZE USER =================
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
