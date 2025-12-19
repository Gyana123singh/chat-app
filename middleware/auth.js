
// middlewares/auth.js
const { verifyToken } = require("../utils/jwtAuth");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    // ✅ sub = userId (JWT STANDARD)
    req.user = {
      id: decoded.sub,          // 🔥 FIX
      email: decoded.email,
      username: decoded.name,
      phone: decoded.phone,
      role: decoded.role || "user",
    };

    if (!req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = { authMiddleware };
