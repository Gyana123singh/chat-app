const { signToken } = require("../utils/jwtAuth");

exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
  }

  const token = signToken(req.user);

  // ✅ Redirect to Vercel frontend
  res.redirect(
    `https://chat-app-admin-dashboard-b3ut.vercel.app/auth/google/success?token=${token}`
  );
};
