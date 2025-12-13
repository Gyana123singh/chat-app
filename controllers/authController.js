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


exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect("http://localhost:3000/login?error=google");
  }

  const token = signToken(req.user);

  // ✅ redirect to Next.js with token
  res.redirect(`http://localhost:3000/auth/google/success?token=${token}`);
};
