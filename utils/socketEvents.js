const roomManager = require("../utils/musicRoomManager");
const VideoRoom = require("../models/videoRoom");
const Leaderboard = require("../models/trophyLeaderBoard");
const MusicState = require("../models/musicState");
const restoreMusicState = require("../utils/restoreMusicState");
const levelController = require("../controllers/levelController");
const Gift = require("../models/gifts");
const GiftTransaction = require("../models/giftTransaction");
const User = require("../models/users"); // adjust path if needed
const PKBattle = require("../models/pkBattle");
const Room = require("../models/room"); // or your room model path
const mongoose = require("mongoose");
const registerStoreGiftSocket = require("../utils/giftSocketEvents");

// pkId -> timeoutId
const pkTimers = new Map();

// Permission Helper (Host/Admin Check)
// Permission Helper (Host/Admin Check) - FIXED

async function isHostOrAdmin(roomId, userId) {
  const room = await Room.findOne({ roomId });

  console.log("🔍 isHostOrAdmin check:", {
    roomId,
    userId,
    foundRoom: !!room,
    roomHost: room?.host,
    roomAdmins: room?.admins,
  });

  if (!room) return false;

  const uid = userId.toString();

  // ✅ Host check (uses `host` from your schema)
  if (room.host && room.host.toString() === uid) return true;

  // ✅ Admin check
  if (Array.isArray(room.admins)) {
    if (room.admins.some((id) => id.toString() === uid)) {
      return true;
    }
  }

  return false;
}

// ===============================
// ⏱️ START PK TIMER (AUTO END)
// ===============================
function startPKTimer(pk, io) {
  // Clear old timer if exists
  if (pkTimers.has(pk._id.toString())) {
    clearTimeout(pkTimers.get(pk._id.toString()));
    pkTimers.delete(pk._id.toString());
  }

  const timer = setTimeout(() => {
    endPKInternal(pk._id, io);
  }, pk.duration * 1000);

  pkTimers.set(pk._id.toString(), timer);
}

// ===============================
// 🎁 DISTRIBUTE PK REWARDS (PK ONLY)
// ===============================
async function distributePKRewards(pk, io) {
  if (!pk || pk.rewardsDistributed) return;

  const WIN_REWARD = 100;
  const LOSE_REWARD = 20;
  const DRAW_REWARD = 50;

  if (pk.winner) {
    const winnerId = pk.winner.toString();
    const loserId =
      pk.leftUser.userId.toString() === winnerId
        ? pk.rightUser.userId.toString()
        : pk.leftUser.userId.toString();

    await levelController.addRoomExp(winnerId, WIN_REWARD, io);
    await levelController.addRoomExp(loserId, LOSE_REWARD, io);
  } else {
    // Draw
    await levelController.addRoomExp(
      pk.leftUser.userId.toString(),
      DRAW_REWARD,
      io,
    );
    await levelController.addRoomExp(
      pk.rightUser.userId.toString(),
      DRAW_REWARD,
      io,
    );
  }

  pk.rewardsDistributed = true;
  await pk.save();
}

// ===============================
// 🏁 END PK (WINNER + CLEANUP)
// ===============================
async function endPKInternal(pkId, io) {
  const pk = await PKBattle.findById(pkId);
  if (!pk || pk.status !== "running") return;

  // End PK
  pk.status = "ended";
  pk.endedAt = new Date();

  // Winner calculation
  if (pk.leftUser.score > pk.rightUser.score) {
    pk.winner = pk.leftUser.userId;
  } else if (pk.rightUser.score > pk.leftUser.score) {
    pk.winner = pk.rightUser.userId;
  } else {
    pk.winner = null; // draw
  }
  if (pk.mvpSupporter) {
    await levelController.addRoomExp(pk.mvpSupporter.toString(), 50, io);

    io.to(pk.mvpSupporter.toString()).emit("pk:mvp", {
      message: "🏆 You are the MVP Supporter! +50 EXP",
    });
  }

  const supporterMap = new Map();

  pk.contributions.forEach((c) => {
    const key = c.fromUser.toString();
    supporterMap.set(key, (supporterMap.get(key) || 0) + c.value);
  });

  const sorted = Array.from(supporterMap.entries())
    .map(([userId, total]) => ({ userId, total }))
    .sort((a, b) => b.total - a.total);

  pk.topSupporters = sorted.slice(0, 10); // top 10
  pk.mvpSupporter = sorted.length > 0 ? sorted[0].userId : null;

  await pk.save();
  // ===============================
  // 📊 Update User PK Stats (W/L/D)
  // ===============================
  const leftId = pk.leftUser.userId.toString();
  const rightId = pk.rightUser.userId.toString();

  const leftUser = await User.findById(leftId);
  const rightUser = await User.findById(rightId);

  if (leftUser && rightUser) {
    if (pk.winner) {
      if (pk.winner.toString() === leftId) {
        leftUser.pkStats.wins += 1;
        rightUser.pkStats.losses += 1;
      } else {
        rightUser.pkStats.wins += 1;
        leftUser.pkStats.losses += 1;
      }
    } else {
      // Draw
      leftUser.pkStats.draws += 1;
      rightUser.pkStats.draws += 1;
    }

    await leftUser.save();
    await rightUser.save();
  }

  // ===============================
  // 🏆 Reward MVP Supporter
  // ===============================
  if (pk.mvpSupporter) {
    try {
      await levelController.addRoomExp(pk.mvpSupporter.toString(), 50, io);

      // Notify MVP user
      io.to(pk.mvpSupporter.toString()).emit("pk:mvp", {
        message: "🏆 You are the MVP Supporter! +50 EXP",
      });
    } catch (e) {
      console.error("❌ MVP reward error:", e.message);
    }
  }

  // 🎁 Distribute rewards (PK ONLY)
  await distributePKRewards(pk, io);

  // 🧹 Clear room.activePK
  const room = await Room.findOne({ roomId: pk.roomId });
  if (room) {
    room.activePK = null;
    await room.save();
  }

  // ⏱️ Clear timer
  const timer = pkTimers.get(pkId.toString());
  if (timer) {
    clearTimeout(timer);
    pkTimers.delete(pkId.toString());
  }

  // 📢 Notify clients
  io.to(`room:${pk.roomId}`).emit("pk:ended", {
    pkId: pk._id,
    leftScore: pk.leftUser.score,
    rightScore: pk.rightUser.score,
    winner: pk.winner,
  });
}

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
      if (!roomId) return;

      const safeUser = user || socket.data.user;
      if (!safeUser || !safeUser.id) {
        console.error("❌ room:join without user identity", { roomId });
        return;
      }

      const roomName = `room:${roomId}`;
      socket.join(roomName);
      socket.data.roomId = roomId;
      socket.data.user = safeUser;

      const userId = safeUser.id;
      // ===============================
      // 🥊 SEND ACTIVE PK STATE (IF ANY)
      // ===============================
      try {
        const roomDoc = await Room.findOne({ roomId });

        if (roomDoc && roomDoc.activePK) {
          const pk = await PKBattle.findById(roomDoc.activePK);

          if (pk && pk.status === "running") {
            console.log("🔥 Sending active PK to joining user:", pk._id);
            socket.emit("pk:started", pk);
          }
        }
      } catch (e) {
        console.error("❌ Failed to send active PK on join:", e.message);
      }

      // 🔥 Init music state safely (no overwrite if already playing)
      // ✅ CORRECT MUSIC STATE HANDLING
      roomManager.initRoom(roomId);
      await restoreMusicState(roomId);

      // Track users
      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Set());
      }
      roomUsers.get(roomId).add(userId);
      console.log(`📍 ${safeUser.username} joined ${roomName}`);

      try {
        /* ===== VIDEO ROOM SYNC ===== */
        let videoRoom = await VideoRoom.findOne({ roomId });
        if (!videoRoom) {
          videoRoom = await VideoRoom.create({
            roomId,
            hostId: userId, // just stored, no restriction
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
                userId: userId,
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
        socket.to(roomName).emit("room:userJoined", safeUser);

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

        // 🎬 Cinematic entrance when user joins room

        const userDoc = await User.findById(userId).select(
          "username profile.avatar level profile.entranceEffect",
        );

        // Check active entrance gift in inventory
        const activeEntrance = await StoreGiftInventory.findOne({
          userId: userId,
          effectType: "ENTRANCE",
          isActive: true,
          expiresAt: { $gt: new Date() },
        });

        const animationUrl =
          activeEntrance?.animationUrl || userDoc?.profile?.entranceEffect;

        if (animationUrl) {
          io.to(`room:${roomId}`).emit("room:cinematicEntrance", {
            userId,
            username: userDoc?.username || "User",
            avatar: userDoc?.profile?.avatar || null,
            level: userDoc?.level || 1,
            animationUrl,
            soundUrl: null,
            rarity: "normal",
          });
        }
        // ===============================
        // ⏱ 5 MIN STAY EXP (PERSONAL)
        // ===============================
        if (!roomStayTimers.has(userId)) {
          const stayTimer = setInterval(
            async () => {
              try {
                await levelController.addPersonalExp(userId, 10, io);

                io.to(userId.toString()).emit("level:exp", {
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

          roomStayTimers.set(userId, stayTimer);
        }
      } catch (err) {
        console.error("❌ room:join error:", err);
      }
    });

    // ===============================
    // 🥊 PK START (SOCKET BROADCAST)
    // ===============================
    socket.on("pk:start", async ({ roomId, pkId }) => {
      try {
        const pk = await PKBattle.findById(pkId);
        if (!pk) return;

        console.log("🔥 Broadcasting PK immediately:", pk._id);

        io.to(`room:${roomId}`).emit("pk:started", pk);
      } catch (e) {
        console.error("❌ pk:start socket error:", e.message);
      }
    });

    socket.on("gift:send", async (payload) => {
      try {
        const fromUserId = socket.data.userId;

        const {
          roomId,
          giftId,
          sendType,
          toUserId = null,
          pkId = null,
          comboCount = 1,
        } = payload;

        if (!fromUserId || !roomId || !giftId || !sendType) {
          return socket.emit("gift:error", { message: "Missing fields" });
        }

        const gift = await Gift.findById(giftId);
        if (!gift || !gift.isAvailable) {
          return socket.emit("gift:error", { message: "Gift not available" });
        }

        const room = await Room.findOne({ roomId });
        if (!room) {
          return socket.emit("gift:error", { message: "Room not found" });
        }

        // =========================
        // 1️⃣ Combo Logic
        // =========================
        const allowedCombos = [1, 9, 49, 99];
        let quantity = 1;

        if (sendType !== "pk") {
          const parsed = Number(comboCount);
          if (allowedCombos.includes(parsed)) {
            quantity = parsed;
          }
        }

        // =========================
        // 2️⃣ Build Recipients
        // =========================
        let recipientIds = [];

        if (sendType === "individual") {
          if (!toUserId) {
            return socket.emit("gift:error", { message: "toUserId required" });
          }
          recipientIds = [toUserId];
        }

        if (sendType === "all_in_room") {
          const sockets = await io.in(`room:${roomId}`).fetchSockets();
          recipientIds = sockets.map((s) => s.data.userId).filter(Boolean);
        }

        if (sendType === "all_on_mic") {
          const sockets = await io.in(`room:${roomId}`).fetchSockets();
          recipientIds = sockets
            .map((s) => s.data.userId)
            .filter((uid) => {
              const state = micStates.get(uid);
              return state && state.muted === false;
            });
        }

        if (sendType === "pk") {
          if (!pkId || !toUserId) {
            return socket.emit("gift:error", {
              message: "pkId and toUserId required",
            });
          }
          recipientIds = [toUserId];
        }

        // Remove sender
        recipientIds = recipientIds.filter(
          (id) => id?.toString() !== fromUserId.toString(),
        );

        if (recipientIds.length === 0) {
          recipientIds = [fromUserId];
        }

        // =========================
        // 3️⃣ Cost Calculation
        // =========================
        const totalCost = gift.price * quantity * recipientIds.length;

        const sender = await User.findById(fromUserId);
        if (!sender) {
          return socket.emit("gift:error", { message: "Sender not found" });
        }

        if (sender.coins < totalCost) {
          return socket.emit("gift:error", { message: "Not enough coins" });
        }

        // =========================
        // 4️⃣ Deduct Coins
        // =========================
        sender.coins -= totalCost;
        await sender.save();

        // =========================
        // 5️⃣ PK Logic (SAFE)
        // =========================
        if (sendType === "pk" && pkId && toUserId) {
          const pk = await PKBattle.findById(pkId);

          if (pk && pk.status === "running") {
            const scoreValue = gift.price;

            if (pk.leftUser.userId.toString() === toUserId.toString()) {
              pk.leftUser.score += scoreValue;
            } else if (pk.rightUser.userId.toString() === toUserId.toString()) {
              pk.rightUser.score += scoreValue;
            }

            pk.contributions.push({
              fromUser: fromUserId,
              toUser: toUserId,
              giftId: gift._id,
              value: scoreValue,
            });

            await pk.save();

            io.to(`room:${pk.roomId}`).emit("pk:update", {
              pkId: pk._id,
              leftScore: pk.leftUser.score,
              rightScore: pk.rightUser.score,
            });
          }
        }

        // =========================
        // 6️⃣ Save Transaction
        // =========================
        // =========================
        // 6️⃣ Save Transaction (FIXED ObjectId TYPES)
        // =========================
        const tx = await GiftTransaction.create({
          roomIdString: roomId,
          senderId: new mongoose.Types.ObjectId(fromUserId),
          giftId: gift._id,
          giftName: gift.name,
          giftIcon: gift.icon,
          giftPrice: gift.price,
          giftCategory: gift.category,
          giftRarity: gift.rarity,
          sendType,
          recipientIds: recipientIds.map(
            (id) => new mongoose.Types.ObjectId(id),
          ),
          recipientCount: recipientIds.length,
          totalCoinsDeducted: totalCost,
          quantity,
          status: "completed",
        });

        // =========================
        // 7️⃣ Broadcast Animation
        // =========================
        io.to(`room:${roomId}`).emit("gift:received", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          recipientIds,
          gift: {
            _id: gift._id,
            name: gift.name,
            icon: gift.icon,
            animationUrl: gift.animationUrl,
            price: gift.price,
            rarity: gift.rarity,
            effectType: gift.effectType,
          },
          quantity,
          sendType,
          pkId: sendType === "pk" ? pkId : null,
        });

        // =========================
        // 8️⃣ Success Response
        // =========================
        socket.emit("gift:success", {
          balance: sender.coins,
          transactionId: tx._id,
        });
      } catch (err) {
        console.error("❌ gift:send FULL ERROR:", err);
        socket.emit("gift:error", { message: "Gift send failed" });
      }
    });

    socket.on("pk:vote", async ({ roomId, pkId, toUserId }) => {
      try {
        const pk = await PKBattle.findById(pkId);
        if (!pk || pk.status !== "running") return;
        if (pk.mode !== "votes") return;

        if (pk.leftUser.userId.toString() === toUserId.toString()) {
          pk.leftUser.score += 1;
        } else if (pk.rightUser.userId.toString() === toUserId.toString()) {
          pk.rightUser.score += 1;
        } else {
          return;
        }

        await pk.save();

        io.to(`room:${roomId}`).emit("pk:update", {
          pkId: pk._id,
          leftScore: pk.leftUser.score,
          rightScore: pk.rightUser.score,
        });
      } catch (e) {
        console.error("❌ pk:vote error:", e.message);
      }
    });

    // ===============================
    // PK MANUAL END EVENTS
    // ===============================

    socket.on("pk:end", async ({ pkId }) => {
      try {
        await endPKInternal(pkId, io);
      } catch (err) {
        console.error("❌ pk:end error:", err);
      }
    });

    socket.on("pk:forceEnd", async ({ pkId }) => {
      try {
        await endPKInternal(pkId, io);
      } catch (err) {
        console.error("❌ pk:forceEnd error:", err);
      }
    });

    // masage image part
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

          const rows = await Leaderboard.find()
            .populate("userId", "username profile.avatar")
            .sort({ [`${period}.coins`]: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

          const formatted = rows.map((e, i) => ({
            rank: skip + i + 1,
            userId: e.userId?._id,
            username: e.userId?.username || "Unknown",
            avatar: e.userId?.profile?.avatar || null,
            level: e.level || 1,
            coins: e[period]?.coins || 0,
          }));

          socket.emit("trophy:leaderboard-data", {
            success: true,
            period,
            leaderboard: formatted,
            page,
            limit,
          });
        } catch (err) {
          console.error("❌ trophy:get-leaderboard:", err.message);
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

    // INVITE USER TO ROOM
    socket.on("room:invite", async ({ roomId, toUserId }) => {
      const fromUserId = socket.data.userId;
      if (!fromUserId || !roomId || !toUserId) return;

      const allowed = await isHostOrAdmin(roomId, fromUserId);
      if (!allowed) return;

      const targetSocket = onlineUsers.get(toUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("room:invited", {
          roomId,
          fromUserId,
          fromUsername: socket.data.username,
        });
      }
    });

    // LOCK SEAT
    socket.on("room:seat:lock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) {
        socket.emit("error:permission", { message: "Not host or admin" });
        return;
      }

      await Room.findOneAndUpdate(
        { roomId },
        { $addToSet: { lockedSeats: seatNumber } },
      );

      io.to(`room:${roomId}`).emit("room:seat:locked", { seatNumber });
    });

    // UNLOCK SEAT
    socket.on("room:seat:unlock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) {
        socket.emit("error:permission", { message: "Not host or admin" });
        return;
      }

      await Room.findOneAndUpdate(
        { roomId },
        { $pull: { lockedSeats: seatNumber } },
      );

      io.to(`room:${roomId}`).emit("room:seat:unlocked", { seatNumber });
    });

    // MIC OFF (Force mute one user)
    socket.on("room:mic:forceOff", async ({ roomId, targetUserId }) => {
      const userId = socket.data.userId;

      console.log("🎯 FORCE OFF REQUEST:", { roomId, userId, targetUserId });

      if (!userId || !roomId || !targetUserId) {
        console.log("❌ Missing fields in forceOff");
        return;
      }

      const allowed = await isHostOrAdmin(roomId, userId);
      console.log("✅ Allowed?", allowed);

      if (!allowed) {
        console.log("⛔ Permission denied for forceOff");
        socket.emit("error:permission", { message: "Not host or admin" });
        return;
      }

      // Update mic state
      micStates.set(targetUserId, { muted: true, speaking: false });

      // Notify room
      io.to(`room:${roomId}`).emit("mic:update", {
        userId: targetUserId,
        muted: true,
        speaking: false,
      });

      // Notify target user directly
      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("mic:forceMuted");
      }

      console.log("🔇 Force muted user:", targetUserId);
    });

    // MUTE EVERYONE
    socket.on("room:mic:muteAll", async ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) {
        socket.emit("error:permission", { message: "Not host or admin" });
        return;
      }

      const sockets = await io.in(`room:${roomId}`).fetchSockets();

      sockets.forEach((s) => {
        const uid = s.data.userId;
        if (uid) {
          micStates.set(uid, { muted: true, speaking: false });

          io.to(`room:${roomId}`).emit("mic:update", {
            userId: uid,
            muted: true,
            speaking: false,
          });
        }
      });

      io.to(`room:${roomId}`).emit("room:mic:mutedAll");
    });

    // LOCK ALL SEATS
    socket.on("room:seats:lockAll", async ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) {
        socket.emit("error:permission", { message: "Not host or admin" });
        return;
      }

      const allSeats = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

      await Room.findOneAndUpdate({ roomId }, { lockedSeats: allSeats });

      io.to(`room:${roomId}`).emit("room:seats:lockedAll");
    });

    // GIVE ADMIN (ONLY HOST CAN DO THIS)
    socket.on("room:giveAdmin", async ({ roomId, targetUserId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId || !targetUserId) return;

      const room = await Room.findOne({ roomId });
      if (!room) return;

      // Only HOST can give admin
      if (!room.host || room.host.toString() !== userId.toString()) {
        socket.emit("error:permission", {
          message: "Only host can give admin",
        });
        return;
      }

      await Room.findOneAndUpdate(
        { roomId },
        { $addToSet: { admins: targetUserId } },
      );

      io.to(`room:${roomId}`).emit("room:adminAdded", {
        userId: targetUserId,
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

          // 🔥 STOP MUSIC IF DJ LEFT (ALWAYS, EVEN IF PAUSED)
          if (
            roomId &&
            musicState.playedBy &&
            musicState.playedBy.toString() === userId.toString()
          ) {
            console.log("🎵 DJ left room, stopping music permanently");

            // 1) Stop in-memory
            roomManager.stopMusic(roomId);

            // 2) Clear DB state completely
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

            // 3) Notify all users
            io.to(`room:${roomId}`).emit("music:stopped", {
              reason: "dj_left",
            });
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
  registerStoreGiftSocket(io);
  return {
    getMicStates: () => micStates,
    getRoomUsers: () => roomUsers,
    getOnlineUsers: () => onlineUsers,
    getRoomManager: () => roomManager,
  };
};
module.exports.startPKTimer = startPKTimer;
