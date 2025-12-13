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

// exports.googleAuthSuccess = async (req, res) => {
//   try {
//     if (!req.user) {
//       return res.status(401).json({ message: "Google auth failed" });
//     }

//     const token = signToken(req.user);

//     // ✅ redirect to frontend
//     res.redirect(`http://localhost:3000/auth/google/success?token=${token}`);
//   } catch (error) {
//     console.error("Auth Success Error:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// };

exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(
      process.env.NODE_ENV === "production"
        ? "https://your-nextjs-domain.com/login?error=google"
        : "http://localhost:3000/login?error=google"
    );
  }

  const token = signToken(req.user);

  const redirectUrl =
    process.env.NODE_ENV === "production"
      ? `https://your-nextjs-domain.com/auth/google/success?token=${token}`
      : `http://localhost:3000/auth/google/success?token=${token}`;

  res.redirect(redirectUrl);
};
