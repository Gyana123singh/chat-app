const User = require("../models/users");
const { signToken } = require("../utils/jwtAuth");

const handleGoogleAuth = async (profile) => {
  const email = profile.emails[0].value;

  let user = await User.findOne({ oauthProviderId: profile.id });
  if (!user) {
    user = await User.findOne({ email });
    if (user) {
      user.oauthProvider = "google";
      user.oauthProviderId = profile.id;
    } else {
      user = new User({
        name: profile.displayName,
        email,
        oauthProvider: "google",
        oauthProviderId: profile.id,
      });
    }
    await user.save();
  }

  return signToken(user);
};

module.exports = { handleGoogleAuth };
