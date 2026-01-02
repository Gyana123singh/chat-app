const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");

// for google OAuth login
// exports.googleAuthSuccess = async (req, res) => {
//   if (!req.user) {
//     return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
//   }

//   const token = signToken(req.user);

//   // ✅ Redirect to Vercel frontend
//   res.redirect(`myapp://auth/google/success?token=${token}`);
//   // res.redirect(
//   //   `https://test-admin-chat-6mpbqb9nw-gyana123singhs-projects.vercel.app/auth/google/success?token=${token}`
//   // );
// };

exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
  }

  const token = encodeURIComponent(signToken(req.user));
  const platform = req.query.platform === "mobile" ? "mobile" : "web";

  if (platform === "mobile") {
    return res.redirect(`myapp://auth/google/success?token=${token}`);
  }

  const webRedirectUrl =
    process.env.CLIENT_URL ||
    "https://test-admin-chat-6mpbqb9nw-gyana123singhs-projects.vercel.app";

  return res.redirect(`${webRedirectUrl}/auth/google/success?token=${token}`);
};

// for phone OTP login
