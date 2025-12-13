const { signToken } = require("../utils/jwt");

exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect("http://localhost:3000/Login?error=google");
  }

  const token = signToken(req.user);

  // ✅ MUST redirect, not res.json
  res.redirect(
    `http://localhost:3000/auth/google/success?token=${token}`
  );
};
