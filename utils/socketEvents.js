const roomManager = require("../utils/musicRoomManager");
const VideoRoom = require("../models/videoRoom");
const Leaderboard = require("../models/trophyLeaderBoard");
const MusicState = require("../models/musicState");
const restoreMusicState = require("../utils/restoreMusicState");
const levelController = require("../controllers/levelController");
const Room = require("../models/room");
const Gift = require("../models/gifts");
const GiftTransaction = require("../models/giftTransaction");
const Transaction = require("../models/transaction");
const User = require("../models/users");
const PKBattle = require("../models/pkBattle");
const { clearPKTimer } = require("../utils/pkScheduler");

const mongoose = require("mongoose");

module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room
  // ===============================
  // WAFA LEVEL TIMERS (SAFE)
  // ===============================
  const roomStayTimers = new Map(); // userId -> interval
  const micExpTimers = new Map(); // userId -> interval

  io.on("connection", (socket) => {
    console.log("✅ Socket connected:", socket.id);

    /* =========================
       USER CONNECT
    ========================= */
    socket.on("user:connect", ({ userId, username, avatar }) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      socket.join(userId.toString()); // 🔥 ADD THIS LINE for CP
      micStates.set(userId, { muted: false, speaking: false });

      console.log("🟢 User connected:", { userId, username });
    });

    /* =========================
       ROOM JOIN
    ========================= */
    socket.on("room:join", async ({ roomId, user }) => {
      if (!roomId || !user) return;

      const roomName = `room:${roomId}`;
      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.user = user;
      // 🔥 Init music state safely (no overwrite if already playing)
      // ✅ CORRECT MUSIC STATE HANDLING
      roomManager.initRoom(roomId);
      await restoreMusicState(roomId);

      // Track users
      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set());
      }
      roomUsers.get(roomId).add(user.id);

      console.log(`📍 ${user.username} joined ${roomName}`);

      try {
        /* ===== VIDEO ROOM SYNC ===== */
        let videoRoom = await VideoRoom.findOne({ roomId });
        if (!videoRoom) {
          videoRoom = await VideoRoom.create({
            roomId,
            hostId: user.id, // just stored, no restriction
            video: { isVisible: false },
            audio: { isMixing: false },
            participants: [],
          });
        }

        await VideoRoom.findOneAndUpdate(
          { roomId },
          {
            $addToSet: {
              participants: {
                userId: user.id,
                role: "listener", // everyone equal
                isReceivingVideo: false,
                videoFPS: 0,
                videoLatency: 0,
                lastVideoFrameReceived: 0,
              },
            },
          },
          { new: true },
        );

        /* ===== USERS LIST ===== */
        const sockets = await io.in(roomName).fetchSockets();

        const usersInRoom = sockets
          .filter((s) => s.data.user && s.id !== socket.id)
          .map((s) => ({
            ...s.data.user,
            mic: micStates.get(s.data.user.id) || {
              muted: false,
              speaking: false,
            },
          }));

        socket.emit("room:users", usersInRoom);
        socket.to(roomName).emit("room:userJoined", user);

        /* ===== MESSAGES ===== */
        const messages = roomMessages.get(roomId) || [];
        socket.emit("room:messages", messages);

        /* ===== MUSIC STATE ===== */

        const currentMusicState = roomManager.getState(roomId);
        const currentPosition = roomManager.getCurrentPosition(roomId);
        const dbState = await MusicState.findOne({ roomId });

        const musicPayload = {
          musicFile: currentMusicState.musicFile,
          isPlaying: currentMusicState.isPlaying,
          startedAt: currentMusicState.startedAt, // ✅ FIX (IMPORTANT)
          currentPosition,
          playedBy: currentMusicState.playedBy,
          musicUrl: dbState?.musicUrl || null,
        };

        // ✅ ONLY SEND STATE (NO AUTOPLAY)
        socket.emit("room:musicState", musicPayload);

        /* ===== VIDEO STATE ===== */
        let currentTime = 0;

        if (videoRoom.video) {
          if (videoRoom.video.isPlaying && videoRoom.video.startedAt) {
            currentTime =
              (Date.now() - new Date(videoRoom.video.startedAt).getTime()) /
                1000 +
              (videoRoom.video.currentTime || 0);
          } else {
            currentTime = videoRoom.video.currentTime || 0;
          }
        }

        socket.emit("room:videoState", {
          video: {
            ...videoRoom.video.toObject(),
            currentTime,
          },
        });

        // ===============================
        // ⏱ 5 MIN STAY EXP (PERSONAL)
        // ===============================
        if (!roomStayTimers.has(user.id)) {
          const stayTimer = setInterval(
            async () => {
              try {
                await levelController.addPersonalExp(user.id, 10, io);

                io.to(user.id.toString()).emit("level:exp", {
                  type: "personal",
                  exp: 10,
                  message: "+10 EXP (5 min stay)",
                });
              } catch (e) {
                console.error("stay exp error:", e.message);
              }
            },
            5 * 60 * 1000,
          );

          roomStayTimers.set(user.id, stayTimer);
        }
      } catch (err) {
        console.error("❌ room:join error:", err);
      }
    });
    // =========================
    // 🎁 GIFT SEND (FINAL & SAFE)
    // =========================

    socket.on(
      "gift:send",
      async ({ roomId, giftId, sendType, quantity = 1 }) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          const senderId = socket.data.userId;
          if (!senderId || !roomId || !giftId) {
            await session.abortTransaction();
            return;
          }

          // 🎁 Validate Gift (SESSION SAFE)
          const gift = await Gift.findOne({
            _id: giftId,
            isAvailable: true,
          }).session(session);

          if (!gift) {
            await session.abortTransaction();
            socket.emit("gift:error", { code: "GIFT_NOT_FOUND" });
            return;
          }

          const roomName = `room:${roomId}`;
          const sockets = await io.in(roomName).fetchSockets();

          // 🎯 Collect recipients (exclude sender)
          let recipients = sockets
            .map((s) => s.data.userId)
            .filter(Boolean)
            .filter((id) => id.toString() !== senderId.toString());

          // 🎤 MIC FILTER
          if (sendType === "all_on_mic") {
            recipients = recipients.filter((uid) => {
              const mic = micStates.get(uid.toString());
              return mic?.muted === false;
            });
          }

          if (recipients.length === 0) {
            await session.abortTransaction();
            socket.emit("gift:error", {
              code: "NO_RECIPIENT",
              message: "No users available",
            });
            return;
          }

          // 🔢 MULTIPLIER (x1, x9, x49, x99, x499)
          const qty = Math.max(1, Math.min(Number(quantity), 499));

          // 💰 TOTAL COST
          const totalCoins = gift.price * qty * recipients.length;

          // 🔥 ATOMIC COIN DEDUCTION
          const sender = await User.findOneAndUpdate(
            { _id: senderId, coins: { $gte: totalCoins } },
            {
              $inc: {
                coins: -totalCoins,
                totalSpent: totalCoins,
              },
            },
            { new: true, session },
          );

          // ❌ INSUFFICIENT COINS
          if (!sender) {
            await session.abortTransaction();

            const balance = await User.findById(senderId).select("coins");

            socket.emit("gift:recharge", {
              requiredCoins: totalCoins,
              currentCoins: balance?.coins || 0,
            });
            return;
          }

          // 🎁 RECEIVERS STATS (NO COINS)
          await User.updateMany(
            { _id: { $in: recipients } },
            {
              $inc: {
                "stats.giftsReceived": qty,
                "trophy.totalContributions": gift.price * qty,
              },
            },
            { session },
          );

          // 🧾 GIFT TRANSACTION
          const [giftTx] = await GiftTransaction.create(
            [
              {
                roomId,
                senderId,
                giftId,
                giftName: gift.name,
                giftIcon: gift.icon,
                giftPrice: gift.price,
                giftCategory: gift.category,
                giftRarity: gift.rarity,
                sendType, // individual | all_in_room | all_on_mic
                quantity: qty,
                recipientCount: recipients.length,
                recipientIds: recipients,
                totalCoinsDeducted: totalCoins,
                status: "completed",
              },
            ],
            { session },
          );

          // 💳 WALLET TRANSACTION (AUDIT SAFE)
          await Transaction.create(
            [
              {
                userId: senderId,
                type: "COIN_SPENT",
                transactionType: "gift",
                gift: gift._id,
                giftName: gift.name,
                coinsUsed: totalCoins,
                sender: senderId,
                room: roomId,
                paymentMethod: "gift",
                status: "SUCCESS",
                completedAt: new Date(),
                message: `Sent ${gift.name} x${qty}`,
              },
            ],
            { session },
          );

          await session.commitTransaction();

          // 🎬 BROADCAST GIFT ANIMATION
          io.to(roomName).emit("gift:animation", {
            sender: {
              id: sender._id,
              username: sender.username,
              avatar: sender.profile.avatar,
            },
            gift: {
              id: gift._id,
              name: gift.name,
              icon: gift.icon,
              rarity: gift.rarity,
              effectType: gift.effectType,
              animationUrl: gift.animationUrl,
            },
            recipients,
            quantity: qty,
            totalCoinsDeducted: totalCoins,
            count: recipients.length,
            sendType,
            txId: giftTx._id,
          });

          // 💰 REALTIME WALLET UPDATE
          io.to(senderId.toString()).emit("coins:update", {
            coins: sender.coins,
          });
        } catch (err) {
          await session.abortTransaction();
          console.error("🎁 Gift send error:", err);
          socket.emit("gift:error", {
            code: "GIFT_FAILED",
            message: "Something went wrong",
          });
        } finally {
          session.endSession();
        }
      },
    );

    /* =========================
        🔥 PK EVENTS
========================= */
    socket.on("gift:send:pk", async ({ roomId, pkId, toUserId, giftId }) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const senderId = socket.data.userId;
        const roomSockets = await io.in(`room:${roomId}`).fetchSockets();
        const isInRoom = roomSockets.some(
          (s) => s.data.userId?.toString() === senderId.toString(),
        );

        if (!isInRoom) throw new Error("User not in room");

        const pk = await PKBattle.findOne({
          _id: pkId,
          roomId,
          status: "running",
        }).session(session);

        if (!pk) throw new Error("PK not active");

        // ❌ self vote
        if (senderId.toString() === toUserId.toString())
          throw new Error("Self vote blocked");

        const gift = await Gift.findById(giftId).session(session);
        if (!gift) throw new Error("Gift not found");

        const sender = await User.findOneAndUpdate(
          { _id: senderId, coins: { $gte: gift.price } },
          { $inc: { coins: -gift.price, totalSpent: gift.price } },
          { new: true, session },
        );

        if (!sender) throw new Error("INSUFFICIENT_COINS");

        // 🎯 scoring
        let scoreValue = gift.price;
        if (pk.mode === "votes") scoreValue = 1;
        if (pk.mode === "earning") scoreValue = Math.floor(gift.price * 0.7);

        if (pk.leftUser.userId.toString() === toUserId) {
          pk.leftUser.score += scoreValue;
        } else if (pk.rightUser.userId.toString() === toUserId) {
          pk.rightUser.score += scoreValue;
        } else {
          throw new Error("Invalid PK side");
        }

        pk.contributions.push({
          fromUser: senderId,
          toUser: toUserId,
          giftId,
          value: scoreValue,
        });

        await pk.save({ session });

        await session.commitTransaction();

        io.to(`room:${roomId}`).emit("pk:score:update", {
          leftScore: pk.leftUser.score,
          rightScore: pk.rightUser.score,
        });

        io.to(senderId.toString()).emit("coins:update", {
          coins: sender.coins,
        });
      } catch (err) {
        await session.abortTransaction();

        if (err.message === "INSUFFICIENT_COINS") {
          socket.emit("gift:recharge");
        }
      } finally {
        session.endSession();
      }
    });

    // 🔁 reconnect sync
    socket.on("pk:getActive", async ({ roomId }) => {
      try {
        const PKBattle = require("../models/pkBattle");

        const pk = await PKBattle.findOne({
          roomId,
          status: "running",
        })
          .populate("leftUser.userId", "username profile.avatar")
          .populate("rightUser.userId", "username profile.avatar");

        if (!pk) return; // ✅ IMPORTANT FIX

        const remainingMs = pk.startedAt
          ? Math.max(
              0,
              pk.duration * 1000 -
                (Date.now() - new Date(pk.startedAt).getTime()),
            )
          : 0;

        socket.emit("pk:started", {
          ...pk.toObject(),
          remainingMs,
        });
      } catch (err) {
        console.error("❌ pk:getActive:", err.message);
      }
    });

    // ❌ cancel by host
    socket.on("pk:cancel", async ({ roomId }) => {
      const PKBattle = require("../models/pkBattle");

      const pk = await PKBattle.findOne({
        roomId,
        status: "running",
      });
      await Room.findOneAndUpdate({ roomId }, { activePK: null });

      if (!pk || pk.hostId.toString() !== socket.data.userId.toString()) return;

      pk.status = "ended";
      pk.endedAt = new Date();
      await pk.save();
      clearPKTimer(pk._id); // ✅ ADD THIS
      io.to(`room:${roomId}`).emit("pk:ended", pk);
    });

    socket.on("pk:end", async ({ roomId }) => {
      try {
        const PKBattle = require("../models/pkBattle");

        const pk = await PKBattle.findOne({
          roomId,
          status: "running",
        });
        await Room.findOneAndUpdate({ roomId }, { activePK: null });
        if (!pk || pk.status === "ended") return;

        pk.status = "ended";

        pk.endedAt = new Date();
        await pk.save();
        clearPKTimer(pk._id); // ✅ ADD THIS
        // 🏆 DECIDE WINNER
        let winnerId = null;

        if (pk.leftUser.score > pk.rightUser.score) {
          winnerId = pk.leftUser.userId;
        } else if (pk.rightUser.score > pk.leftUser.score) {
          winnerId = pk.rightUser.userId;
        }

        io.to(`room:${roomId}`).emit("pk:ended", {
          pk,
          winnerId,
        });
      } catch (err) {
        console.error("❌ pk:end error:", err.message);
      }
    });

    socket.on("message:image", ({ roomId, imageUrl, width, height }) => {
      const { userId, username, avatar } = socket.data;

      if (!roomId || !imageUrl) return;

      const message = {
        id: `${userId}-${Date.now()}`,
        type: "image",
        userId,
        username,
        avatar,
        imageUrl,
        width: width || null,
        height: height || null,
        timestamp: new Date().toISOString(),
      };

      if (!roomMessages.has(roomId)) {
        roomMessages.set(roomId, []);
      }

      roomMessages.get(roomId).push(message);

      io.to(`room:${roomId}`).emit("message:receive", message);
    });

    /* =========================
   VIDEO CONTROLS (ALL USERS)
========================= */

    socket.on("video:play", ({ roomId, userId }) => {
      if (!roomId) return;

      // ✅ socket only broadcasts (no DB write)
      io.to(`room:${roomId}`).emit("video:started", {
        startedBy: userId,
      });
    });

    socket.on("video:pause", ({ roomId }) => {
      if (!roomId) return;

      io.to(`room:${roomId}`).emit("video:paused");
    });

    socket.on("video:resume", ({ roomId }) => {
      if (!roomId) return;

      io.to(`room:${roomId}`).emit("video:resumed");
    });

    socket.on("video:stop", ({ roomId }) => {
      if (!roomId) return;

      io.to(`room:${roomId}`).emit("video:stopped");
    });

    /* =========================
   VIDEO STREAM SIGNALING (NEW)
========================= */

    // Host starts video streaming
    socket.on("video:stream:start", ({ roomId }) => {
      if (!roomId) return;

      console.log("🎬 Video stream start request:", roomId);

      // Notify all users in room to prepare WebRTC
      socket.to(`room:${roomId}`).emit("video:stream:ready", {
        from: socket.data.userId,
      });
    });

    // WebRTC Offer
    socket.on("video:webrtc:offer", ({ roomId, offer }) => {
      if (!roomId || !offer) return;

      socket.to(`room:${roomId}`).emit("video:webrtc:offer", {
        from: socket.data.userId,
        offer,
      });
    });

    // WebRTC Answer
    socket.on("video:webrtc:answer", ({ roomId, answer }) => {
      if (!roomId || !answer) return;

      socket.to(`room:${roomId}`).emit("video:webrtc:answer", {
        from: socket.data.userId,
        answer,
      });
    });

    // ICE Candidate
    socket.on("video:webrtc:ice", ({ roomId, candidate }) => {
      if (!roomId || !candidate) return;

      socket.to(`room:${roomId}`).emit("video:webrtc:ice", {
        from: socket.data.userId,
        candidate,
      });
    });

    /* =========================
       MIC CONTROLS
    ========================= */
    socket.on("mic:mute", () => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      micStates.set(userId, { muted: true, speaking: false });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: true,
        speaking: false,
      });
      if (micExpTimers.has(userId)) {
        clearInterval(micExpTimers.get(userId));
        micExpTimers.delete(userId);
      }
    });

    socket.on("mic:unmute", () => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      micStates.set(userId, { muted: false, speaking: false });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking: false,
      });
      if (micExpTimers.has(userId)) {
        clearInterval(micExpTimers.get(userId));
        micExpTimers.delete(userId);
      }
    });

    socket.on("mic:speaking", (speaking) => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      const state = micStates.get(userId);
      if (!state || state.muted) return;

      micStates.set(userId, { ...state, speaking });

      socket.to(`room:${roomId}`).emit("mic:update", {
        userId,
        muted: false,
        speaking,
      });

      // ===============================
      // 🎤 10 MIN ROOM EXP (WAFA)
      // ===============================
      if (speaking === true && !micExpTimers.has(userId)) {
        const micTimer = setInterval(
          async () => {
            try {
              await levelController.addRoomExp(userId, 20, io);

              io.to(userId.toString()).emit("level:exp", {
                type: "room",
                exp: 20,
                message: "+20 Room EXP (10 min mic)",
              });
            } catch (err) {
              console.error("❌ mic EXP error:", err.message);
            }
          },
          10 * 60 * 1000,
        );

        micExpTimers.set(userId, micTimer);
      }

      // ❌ stop mic EXP when not speaking
      if (speaking === false && micExpTimers.has(userId)) {
        clearInterval(micExpTimers.get(userId));
        micExpTimers.delete(userId);
      }
    });

    /* =========================
       EMOJI
    ========================= */
    socket.on("send_emoji", ({ roomId, userId, emoji }) => {
      if (!roomId || !userId || !emoji) return;

      io.to(`room:${roomId}`).emit("receive_emoji", {
        userId,
        emoji,
        timestamp: Date.now(),
      });
    });

    /* =========================
       WEBRTC SIGNALING
    ========================= */
    socket.on("call:offer", ({ to, offer }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("call:offer", {
          from: socket.data.userId,
          offer,
        });
      }
    });

    socket.on("call:answer", ({ to, answer }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("call:answer", {
          from: socket.data.userId,
          answer,
        });
      }
    });

    socket.on("call:ice", ({ to, candidate }) => {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit("call:ice", {
          from: socket.data.userId,
          candidate,
        });
      }
    });

    /* =========================
       CHAT
    ========================= */
    socket.on("message:send", ({ roomId, text }) => {
      const { userId, username, avatar } = socket.data;
      if (!roomId || !text || !userId) return;

      const roomName = `room:${roomId}`;

      const message = {
        id: `${userId}-${Date.now()}`,
        userId,
        username,
        avatar,
        text,
        timestamp: new Date().toISOString(),
      };

      if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
      roomMessages.get(roomId).push(message);

      io.to(roomName).emit("message:receive", message);
    });

    socket.on("message:typing", ({ roomId, isTyping }) => {
      const { userId, username } = socket.data;
      if (!roomId || !userId) return;

      const roomName = `room:${roomId}`;

      if (!typingUsers.has(roomId)) typingUsers.set(roomId, new Set());

      const typingSet = typingUsers.get(roomId);
      if (isTyping) typingSet.add(userId);
      else typingSet.delete(userId);

      socket.to(roomName).emit("message:typing", {
        userId,
        username,
        isTyping,
        typingUsers: Array.from(typingSet),
      });
    });

    /* =========================
       TROPHY / LEADERBOARD
    ========================= */
    socket.on(
      "trophy:get-leaderboard",
      async ({ period = "daily", page = 1, limit = 20 }) => {
        try {
          if (!["daily", "weekly", "monthly", "allTime"].includes(period)) {
            return socket.emit("trophy:error", { message: "Invalid period" });
          }

          const skip = (page - 1) * limit;
          const leaderboard = await Leaderboard.find()
            .populate("userId", "username profile.avatar")
            .sort({ [`${period}.coins`]: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

          const formatted = leaderboard.map((entry, index) => ({
            rank: skip + index + 1,
            userId: entry.userId?._id,
            username: entry.userId?.username || "Unknown",
            avatar: entry.userId?.profile?.avatar || null,
            coins: entry[period].coins,
            level: entry.level || 1,
          }));

          socket.emit("trophy:leaderboard-data", {
            success: true,
            leaderboard: formatted,
            period,
          });
        } catch (err) {
          console.error("❌ trophy:get-leaderboard error:", err);
          socket.emit("trophy:error", {
            message: "Failed to fetch leaderboard",
          });
        }
      },
    );

    /* =========================
       FRIEND REQUEST
    ========================= */
    socket.on("friend:request:send", ({ toUserId }) => {
      const fromUserId = socket.data.userId;
      const targetSocket = onlineUsers.get(toUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("friend:request:received", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
        });
      }
    });

    socket.on("friend:request:accept", ({ toUserId }) => {
      const fromUserId = socket.data.userId;
      const targetSocket = onlineUsers.get(toUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("friend:request:accepted", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
        });
      }
    });

    /* =========================
       ROOM STATUS
    ========================= */
    socket.on("room:getUsersStatus", async ({ roomId }) => {
      if (!roomId) return;

      const roomName = `room:${roomId}`;
      const sockets = await io.in(roomName).fetchSockets();

      const usersStatus = sockets
        .filter((s) => s.data.user)
        .map((s) => ({
          userId: s.data.user.id,
          username: s.data.user.username,
          avatar: s.data.user.avatar,
          mic: micStates.get(s.data.user.id) || {
            muted: false,
            speaking: false,
          },
        }));

      socket.emit("room:usersStatus", {
        allUsers: usersStatus,
        onMicUsers: usersStatus.filter((u) => !u.mic.muted),
        speakingUsers: usersStatus.filter((u) => u.mic.speaking),
      });
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", async () => {
      const { roomId, userId, user } = socket.data;

      try {
        if (userId) {
          onlineUsers.delete(userId);
          micStates.delete(userId);
          // ===============================
          // 🔥 CLEAR LEVEL TIMERS (ALWAYS)
          // ===============================
          if (roomStayTimers.has(userId)) {
            clearInterval(roomStayTimers.get(userId));
            roomStayTimers.delete(userId);
          }

          if (micExpTimers.has(userId)) {
            clearInterval(micExpTimers.get(userId));
            micExpTimers.delete(userId);
          }
          if (roomId && typingUsers.has(roomId)) {
            typingUsers.get(roomId).delete(userId);
          }

          if (roomId && roomUsers.has(roomId)) {
            roomUsers.get(roomId).delete(userId);
          }

          const musicState = roomManager.getState(roomId);

          // 🔥 STOP MUSIC ONLY IF OWNER LEFT
          if (
            roomId &&
            musicState.isPlaying &&
            musicState.playedBy &&
            musicState.playedBy.toString() === userId.toString()
          ) {
            io.to(`room:${roomId}`).emit("music:stopped", {
              message: "Music owner left. Music stopped.",
            });

            roomManager.stopMusic(roomId);

            await MusicState.findOneAndUpdate(
              { roomId },
              {
                musicFile: null,
                musicUrl: null,
                isPlaying: false,
                pausedAt: 0,
                startedAt: null,
                localFilePath: null,
                playedBy: null,
              },
            );
          }
        }

        if (roomId && user) {
          socket
            .to(`room:${roomId}`)
            .emit("room:userLeft", { userId: user.id });
        }

        console.log("❌ Socket disconnected:", socket.id);
      } catch (err) {
        console.error("❌ Disconnect cleanup error:", err);
      }
    });
  });

  return {
    getMicStates: () => micStates,
    getRoomUsers: () => roomUsers,
    getOnlineUsers: () => onlineUsers,
    getRoomManager: () => roomManager,
  };
};
