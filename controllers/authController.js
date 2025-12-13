const { signToken } = require("../utils/jwt");

// exports.googleAuthSuccess = async (req, res) => {
//   if (!req.user) {
//     return res.status(400).json({ message: "Google auth failed" });
//   }

//   const token = signToken(req.user);

//   res.json({
//     message: "Google Login Successful",
//     user: req.user,
//     token,
//   });
// };

// exports.googleAuthSuccess = async (req, res) => {
//   if (!req.user) {
//     return res.redirect("http://localhost:3000/login?error=google");
//   }

//   const token = signToken(req.user);

//   // ✅ redirect to Next.js with token
//   res.redirect(`http://localhost:3000/auth/google/success?token=${token}`);
// };

exports.googleAuthSuccess = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Google auth failed" });
    }

    const token = signToken(req.user);

    return res.status(200).json({
      message: "Google Login Successful",
      token,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};
