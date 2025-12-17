const { signToken } = require("../utils/jwtAuth");
const admin = require("../config/firebase");
const User = require("../models/users");

// for google OAuth login
exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
  }

  const token = signToken(req.user);

  // ✅ Redirect to Vercel frontend
  res.redirect(`myapp://auth/google/success?token=${token}`);
};

// for phone OTP login

exports.phoneOtpAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: "ID Token required" });
    }

    // Verify Firebase OTP token
    const decoded = await admin.auth().verifyIdToken(idToken);

    const phone = decoded.phone_number;
    const firebaseUid = decoded.uid;

    let user = await User.findOne({ firebaseUid });

    if (!user) {
      user = await User.create({
        firebaseUid,
        phone,
        isVerified: true,
      });
    }

    const token = signToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user,
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid OTP",
    });
  }
};
