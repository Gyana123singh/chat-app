const User = require("../models/Users");
const { generateToken } = require("../utils/jwt");

const handleFacebookAuth = async (profile) => {
  const email = profile.emails?.[0]?.value;

  let user = await User.findOne({ oauthProviderId: profile.id });
  if (!user) {
    user = await User.findOne({ email });
    if (user) {
      user.oauthProvider = "facebook";
      user.oauthProviderId = profile.id;
    } else {
      user = new User({
        name: profile.displayName,
        email,
        oauthProvider: "facebook",
        oauthProviderId: profile.id,
      });
    }
    await user.save();
  }

  return generateToken(user);
};

module.exports = { handleFacebookAuth };
