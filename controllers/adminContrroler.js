const bcrypt = require("bcryptjs");
const { signToken } = require("../utils/jwtAuth");

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1️⃣ Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // 2️⃣ Match email from ENV
    if (email !== process.env.ADMIN_EMAIL) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // 3️⃣ Match password from ENV
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // 4️⃣ Create ADMIN payload (no DB user)
    const adminUser = {
      _id: "admin-id",
      email: process.env.ADMIN_EMAIL,
      username: "Admin",
      role: "admin",
    };

    // 5️⃣ Sign token
    const token = signToken(adminUser);

    // 6️⃣ Success
    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      token,
      user: {
        email: adminUser.email,
        username: adminUser.username,
        role: adminUser.role,
      },
    });
  } catch (error) {
    console.error("ADMIN LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
