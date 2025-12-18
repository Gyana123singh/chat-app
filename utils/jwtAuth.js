const jwt = require("jsonwebtoken");

function signToken(user) {
  const payload = {
    id: user._id.toString(),
    sub: user._id.toString(),
    email: user.email || null,
    name: user.username || null,
    phone: user.phone || null,
    role: user.role,
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
