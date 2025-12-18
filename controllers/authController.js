const { signToken } = require("../utils/jwtAuth");

exports.googleAuthSuccess = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Google auth failed" });
    }

    const token = signToken(req.user);

    // 🔥 Use HTTP redirect for Flutter / Web
    res.redirect(res.redirect(`myapp://auth/google/success?token=${token}`));
  } catch (error) {
    console.error("❌ GOOGLE AUTH SUCCESS ERROR:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
