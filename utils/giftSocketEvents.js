module.exports = (io) => {
  const onlineUsers = new Map(); // userId -> socketId
  const userCoins = new Map(); // userId -> coins (sync with DB)
  const giftNotifications = new Map(); // userId -> [notifications]

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER REGISTER
    ========================= */
    socket.on("user:register", ({ userId, username, avatar }) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      console.log("🟢 User registered:", { userId, username });
    });

    /* =========================
       🎁 GIFT NOTIFICATION (Direct to user, no room needed)
    ========================= */
    socket.on("gift:notify", ({ receiverId, giftData }) => {
      const { userId, username, avatar } = socket.data;

      if (!receiverId || !giftData || !userId) return;

      const notification = {
        id: `${userId}-${Date.now()}`,
        senderId: userId,
        senderUsername: username,
        senderAvatar: avatar,
        giftName: giftData.name,
        giftIcon: giftData.icon,
        giftPrice: giftData.price,
        giftRarity: giftData.rarity,
        quantity: giftData.quantity || 1,
        timestamp: new Date().toISOString(),
        read: false,
      };

      // Store notification
      if (!giftNotifications.has(receiverId)) {
        giftNotifications.set(receiverId, []);
      }
      giftNotifications.get(receiverId).push(notification);

      // Get receiver's socket ID
      const receiverSocketId = onlineUsers.get(receiverId);

      // Send to receiver if online
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("gift:received", {
          ...notification,
          message: `${username} sent you ${giftData.name}!`,
        });

        console.log(`🎁 Gift sent to ${receiverId}:`, {
          from: username,
          gift: giftData.name,
          price: giftData.price,
        });
      } else {
        console.log(
          `⏰ User ${receiverId} offline. Notification stored for later.`
        );
      }
    });

    /* =========================
       🎁 GIFT SEND TO MULTIPLE (Room-based without join)
    ========================= */
    socket.on("gift:sendMultiple", ({ roomId, recipientIds, giftData }) => {
      const { userId, username, avatar } = socket.data;

      if (!roomId || !recipientIds || !giftData || !userId) return;

      const notification = {
        id: `${userId}-${Date.now()}`,
        senderId: userId,
        senderUsername: username,
        senderAvatar: avatar,
        giftName: giftData.name,
        giftIcon: giftData.icon,
        giftPrice: giftData.price,
        giftRarity: giftData.rarity,
        quantity: giftData.quantity || 1,
        timestamp: new Date().toISOString(),
        read: false,
      };

      // Send to each recipient
      recipientIds.forEach((recipientId) => {
        if (recipientId.toString() === userId.toString()) return; // Don't send to self

        // Store notification
        if (!giftNotifications.has(recipientId)) {
          giftNotifications.set(recipientId, []);
        }
        giftNotifications.get(recipientId).push(notification);

        // Get recipient's socket ID
        const recipientSocketId = onlineUsers.get(recipientId);

        // Send to recipient if online
        if (recipientSocketId) {
          io.to(recipientSocketId).emit("gift:received", {
            ...notification,
            message: `${username} sent you ${giftData.name}!`,
            roomId,
          });
        }
      });

      // Broadcast gift animation to room
      io.to(`room:${roomId}`).emit("gift:animation", {
        senderId: userId,
        senderUsername: username,
        senderAvatar: avatar,
        giftName: giftData.name,
        giftIcon: giftData.icon,
        giftPrice: giftData.price,
        giftRarity: giftData.rarity,
        recipientCount: recipientIds.filter(
          (id) => id.toString() !== userId.toString()
        ).length,
        totalCoinsTransferred:
          giftData.price *
          recipientIds.filter((id) => id.toString() !== userId.toString())
            .length,
        timestamp: new Date().toISOString(),
      });

      console.log(`🎁 Gift sent to ${recipientIds.length} users:`, {
        from: username,
        gift: giftData.name,
        room: roomId,
        totalCoins: giftData.price * recipientIds.length,
      });
    });

    /* =========================
       🎁 GET STORED NOTIFICATIONS (for offline users)
    ========================= */
    socket.on("gift:getNotifications", ({ userId }) => {
      if (!userId) return;

      const notifications = giftNotifications.get(userId) || [];

      socket.emit("gift:notifications", {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      });

      console.log(`📬 Sent ${notifications.length} notifications to ${userId}`);
    });

    /* =========================
       🎁 MARK NOTIFICATION AS READ
    ========================= */
    socket.on("gift:markAsRead", ({ userId, notificationId }) => {
      if (!userId || !notificationId) return;

      const notifications = giftNotifications.get(userId);
      if (!notifications) return;

      const notification = notifications.find((n) => n.id === notificationId);
      if (notification) {
        notification.read = true;
      }

      console.log(`✅ Notification ${notificationId} marked as read`);
    });

    /* =========================
       🎁 CLEAR NOTIFICATIONS
    ========================= */
    socket.on("gift:clearNotifications", ({ userId }) => {
      if (!userId) return;

      giftNotifications.delete(userId);

      console.log(`🗑️ All notifications cleared for ${userId}`);
    });

    /* =========================
       💰 UPDATE USER COINS (sync with DB)
    ========================= */
    socket.on("user:updateCoins", ({ userId, coins }) => {
      if (!userId || coins === undefined) return;

      userCoins.set(userId, coins);

      // Broadcast to all sockets of this user
      const userSocketId = onlineUsers.get(userId);
      if (userSocketId) {
        io.to(userSocketId).emit("user:coinsUpdated", {
          coins,
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`💰 Coins updated for ${userId}:`, coins);
    });

    /* =========================
       GET USER COINS
    ========================= */
    socket.on("user:getCoins", ({ userId }) => {
      if (!userId) return;

      const coins = userCoins.get(userId) || 0;

      socket.emit("user:coins", { coins });
    });

    /* =========================
       🎁 GIFT LEADERBOARD
    ========================= */
    socket.on("gift:getLeaderboard", () => {
      // Sort onlineUsers by coins
      const leaderboard = Array.from(userCoins.entries())
        .sort((a, b) => b - a)
        .slice(0, 10)
        .map(([userId, coins], index) => ({
          rank: index + 1,
          userId,
          coins,
          isOnline: onlineUsers.has(userId),
        }));

      socket.emit("gift:leaderboard", leaderboard);

      console.log("📊 Leaderboard sent");
    });

    /* =========================
       🎁 SEND GIFT FROM STORE API (via Socket)
    ========================= */
    socket.on("store:giftSend", ({ receiverId, giftData, totalCoinsDeducted }) => {
      const { userId, username, avatar } = socket.data;

      if (!receiverId || !giftData || !userId) return;

      // Create notification
      const notification = {
        id: `${userId}-${Date.now()}`,
        senderId: userId,
        senderUsername: username,
        senderAvatar: avatar,
        giftName: giftData.name,
        giftIcon: giftData.icon,
        giftPrice: giftData.price,
        giftRarity: giftData.rarity,
        quantity: giftData.quantity || 1,
        totalCoinsDeducted,
        timestamp: new Date().toISOString(),
        read: false,
        source: "store", // Identify as store gift
      };

      // Store notification for receiver
      if (!giftNotifications.has(receiverId)) {
        giftNotifications.set(receiverId, []);
      }
      giftNotifications.get(receiverId).push(notification);

      // Get receiver socket
      const receiverSocketId = onlineUsers.get(receiverId);

      // Send notification to receiver
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("store:giftReceived", {
          ...notification,
          message: `${username} sent you ${giftData.name}!`,
          animation: true,
        });

        console.log(`🎁 Store gift sent to ${receiverId}:`, {
          from: username,
          gift: giftData.name,
          coinsDeducted: totalCoinsDeducted,
        });
      } else {
        console.log(
          `⏰ User ${receiverId} offline. Store gift notification stored.`
        );
      }
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", () => {
      const { userId } = socket.data;

      if (userId) {
        onlineUsers.delete(userId);
        console.log(`❌ User ${userId} disconnected`);
      }

      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  // Return helper functions
  return {
    getOnlineUsers: () => onlineUsers,
    getUserCoins: () => userCoins,
    getNotifications: (userId) => giftNotifications.get(userId) || [],
    sendDirectNotification: (userId, data) => {
      const socketId = onlineUsers.get(userId);
      if (socketId) {
        io.to(socketId).emit("gift:received", data);
      }
    },
    broadcastToRoom: (roomId, event, data) => {
      io.to(`room:${roomId}`).emit(event, data);
    },
  };
};
