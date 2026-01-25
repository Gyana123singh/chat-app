const onlineUsers = new Map();

module.exports = (io) => {
  io.on("connection", (socket) => {

    socket.on("user-online", (userId) => {
      onlineUsers.set(userId, socket.id);
    });

    socket.on("disconnect", () => {
      onlineUsers.forEach((v, k) => {
        if (v === socket.id) onlineUsers.delete(k);
      });
    });
  });

  io.getSocketId = (userId) => onlineUsers.get(userId);
};
