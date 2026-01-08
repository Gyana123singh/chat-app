const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");

// for google OAuth login
exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
  }

  const token = signToken(req.user);

  // ✅ Redirect to Vercel frontend
  // res.redirect(`myapp://auth/google/success?token=${token}`);
  res.redirect(
    `https://chat-5lefvn25v-gyana123singhs-projects.vercel.app/auth/google/success?token=${token}`
  );
};

// for phone OTP login
