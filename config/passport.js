const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const util = require("util");
const User = require("../models/users");

// Helper to mask sensitive values in logs
const mask = (s) => {
  if (!s) return "<<missing>>";
  const str = String(s);
  return "****" + str.slice(-6);
};

const clientID = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackURL =
  process.env.GOOGLE_CALLBACK_URL ||
  "https://chat-app-1-qvl9.onrender.com/auth/google/callback";

// Dummy strategy to avoid "Unknown authentication strategy 'google'" errors
function registerDummyStrategy(message) {
  function DummyStrategy() {
    passport.Strategy.call(this);
    this.name = "google";
  }
  util.inherits(DummyStrategy, passport.Strategy);
  DummyStrategy.prototype.authenticate = function () {
    this.error(new Error(message));
  };
  passport.use(new DummyStrategy());
}

if (!clientID || !clientSecret) {
  console.warn(
    `[GOOGLE OAUTH] Missing configuration. GOOGLE_CLIENT_ID: ${mask(
      clientID
    )}, GOOGLE_CLIENT_SECRET: ${mask(
      clientSecret
    )}. Google strategy will not be initialized.`
  );
  registerDummyStrategy("Google OAuth not configured on this server");
} else {
  try {
    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL,
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
                profile: { avatar: profile.photos?.[0]?.value },
              });
            }

            return done(null, user);
          } catch (err) {
            console.error("GOOGLE AUTH ERROR →", err);
            return done(err, null);
          }
        }
      )
    );

    console.log(
      `[GOOGLE OAUTH] Initialized (clientID ends ${clientID.slice(
        -6
      )}), callbackURL: ${callbackURL}`
    );
  } catch (err) {
    console.error("[GOOGLE OAUTH] Strategy initialization failed:", err);
    registerDummyStrategy("Google OAuth initialization failed");
  }
}

module.exports = passport;
