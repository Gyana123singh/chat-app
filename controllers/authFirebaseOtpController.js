const admin = require("../config/firebaseAdmin");
const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");

exports.firebaseOtpLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: "ID token required" });
    }

    // 🔐 Verify Firebase ID Token
    const decoded = await admin.auth().verifyIdToken(idToken);

    const phoneNumber = decoded.phone_number;

    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number not found" });
    }

    // 🌍 Country code detection
    let countryCode = "";
    if (phoneNumber.startsWith("+91")) countryCode = "+91";
    else if (phoneNumber.startsWith("+92")) countryCode = "+92";
    else if (phoneNumber.startsWith("+880")) countryCode = "+880";
    else {
      return res.status(400).json({ message: "Country not supported" });
    }

    // 🔍 Find or create user
    let user = await User.findOne({ phone: phoneNumber });

    if (!user) {
      user = await User.create({
        phone: phoneNumber,
        countryCode,
        username: `user_${phoneNumber.slice(-4)}`, // auto username
        role: "user",
      });
    }

    // 🔑 SIGN JWT (✅ CORRECT)
    const token = signToken(user);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        phone: user.phone,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("OTP LOGIN ERROR:", error);
    res.status(401).json({ message: "Invalid or expired OTP" });
  }
};
