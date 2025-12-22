const { verifyToken } = require("../utils/jwtAuth");

module.exports = (io) => {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = verifyToken(token);

      socket.user = {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
      };

      next();
    } catch (error) {
      next(new Error("Invalid token"));
    }
  });
};
