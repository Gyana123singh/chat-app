const { verifyToken } = require("../utils/jwtAuth");

module.exports = (io) => {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = verifyToken(token);

      // 🔥 Store user safely inside socket.data (BEST PRACTICE)
      socket.data.user = {
        id: decoded.sub,
        username: decoded.name || decoded.email,
        email: decoded.email,
        role: decoded.role,
        avatar: decoded.avatar || "/avatar.png",
      };

      next();
    } catch (error) {
      console.error("Socket auth error:", error.message);
      next(new Error("Invalid token"));
    }
  });
};
