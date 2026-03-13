const User = require("../models/users");
const generateDisplayId = require("../utils/generateDisplayId");

const handleGoogleAuth = async (profile) => {
  const email = profile.emails?.[0]?.value;
  if (!email) return null;

  let user = await User.findOne({ oauthProviderId: profile.id });

  if (!user) {
    user = await User.findOne({ email });

    if (user) {
      user.oauthProvider = "google";
      user.oauthProviderId = profile.id;
    } else {
      const displayId = await generateDisplayId();
      user = await User.create({
        username: profile.displayName,
        email,
        displayId, // ⭐ NEW
        oauthProvider: "google",
        oauthProviderId: profile.id,
        isVerified: true,
        profile: {
          avatar: profile.photos?.[0]?.value,
        },
      });
    }

    await user.save();
  }

  return user; // ✅ USER ONLY
};

module.exports = { handleGoogleAuth };
