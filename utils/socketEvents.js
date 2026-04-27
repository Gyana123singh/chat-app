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
const StoreGiftInventory = require("../models/storeGiftInventory");
const calculateProfitLoss = require("../utils/profitLossLuckEngine");
const Message = require("../models/message");
async function getRoomSafe(roomId) {
  return await Room.findOne({ roomId });
}
// pkId -> timeoutId
const pkTimers = new Map();
const backgroundUsers = new Map(); // userId -> true
const seats = new Map(); // ✅ roomId -> [userIds]

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
    registerStoreGiftSocket(socket, io);
    /* =========================
       USER CONNECT
    ========================= */
    socket.on("user:connect", async ({ userId, username, avatar }) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      // ✅ RESET BACKGROUND STATE
      backgroundUsers.delete(userId.toString());
      socket.data.isBackground = false;
      // ✅ DEFAULT STATE (CRITICAL FIX)
      socket.data.isWatcher = true;
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.avatar = avatar;

      socket.join(userId.toString());
      micStates.set(userId, { muted: false, speaking: false });

      // 🔥 Cache profile data
      const user = await User.findById(userId)
        .select("profile.bubble profile.frame level displayId")
        .lean();
      socket.data.displayId = user?.displayId; // ✅ ADD THIS LINE
      socket.data.displayId = user?.displayId; // ✅ REQUIRED
      socket.data.profile = {
        bubble: user?.profile?.bubble || null,
        frame: user?.profile?.frame?.icon || null,
        level: user?.level?.personal?.level || 1,
      };
    });

    /* =========================
   ROOM WATCH (AUDIENCE MODE)
========================= */
    socket.on("room:watch", async ({ roomId, user }) => {
      if (!roomId || !user) return;

      const roomName = `room:${roomId}`;
      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.isWatcher = true;

      // ⭐ SAFE USER SETUP
      socket.data.user = user;
      socket.data.userId = socket.data.userId || user.id;
      socket.data.username = user.username;
      socket.data.avatar = user.avatar;

      console.log("👀 User watching room:", roomId);

      try {
        // ===============================
        // ✅ FETCH ROOM
        // ===============================
        const roomDoc = await Room.findOne({ roomId });

        /* ===== USERS LIST ===== */
        const sockets = await io.in(roomName).fetchSockets();

        // ✅ STEP 1: Collect user IDs
        const userIds = sockets
          .filter((s) => s.data.user)
          .map((s) => s.data.user.id);

        // ✅ STEP 2: Fetch users from DB (INCLUDING displayId)
        const users = await User.find({ _id: { $in: userIds } })
          .select("displayId username profile.avatar")
          .lean();

        // ✅ STEP 3: Create fast lookup map
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));

        // ✅ STEP 4: Build users list with displayId
        const usersInRoom = sockets
          .filter((s) => s.data.user)
          .map((s) => {
            const userIdStr = s.data.userId?.toString();
            const dbUser = userMap.get(userIdStr);
            const seatSnapshot = new Set(
              (seats.get(roomId) || []).map((id) => id.toString()),
            );
            return {
              ...s.data.user,
              displayId: dbUser?.displayId || null, // ✅ ADDED
              username: dbUser?.username || s.data.user.username,
              avatar: dbUser?.profile?.avatar || s.data.user.avatar,
              isWatcher: !seatSnapshot.has(userIdStr),
              isBackground: backgroundUsers.has(userIdStr),
              mic: micStates.get(userIdStr) || {
                muted: false,
                speaking: false,
              },
            };
          });

        socket.emit("room:users", usersInRoom);

        /* ===== MESSAGES ===== */
        socket.emit("room:messages", roomMessages.get(roomId) || []);

        /* ===== MUSIC ===== */
        const currentMusicState = roomManager.getState(roomId);
        const currentPosition = roomManager.getCurrentPosition(roomId);

        socket.emit("room:musicState", {
          ...currentMusicState,
          currentPosition,
        });

        /* ===== SEAT COUNT ===== */
        socket.emit("room:seatCount", {
          roomId,
          seatCount: roomDoc?.seatCount || 12,
        });

        /* ===== DESCRIPTION ===== */
        socket.emit("room:description", {
          roomId,
          description: roomDoc?.description || "",
        });

        /* ===== VIDEO ===== */
        const videoRoom = await VideoRoom.findOne({ roomId });

        if (videoRoom) {
          socket.emit("room:videoState", {
            video: videoRoom.video,
          });
        }

        /* ===== PK STATE ===== */
        if (roomDoc?.activePK) {
          const pk = await PKBattle.findById(roomDoc.activePK);
          if (pk && pk.status === "running") {
            socket.emit("pk:started", pk);
          }
        }
      } catch (err) {
        console.error("❌ room:watch error:", err);
      }
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
      socket.data.userId = safeUser.id; // FIRST
      // ✅ ALWAYS JOIN AS WATCHER
      socket.data.isWatcher = true;

      // ❌ DO NOT ADD TO SEATS HERE
      // 🔥 attach displayId into user object
      const dbUser = await User.findById(safeUser.id)
        .select("displayId username profile.avatar")
        .lean();

      socket.data.user = {
        id: safeUser.id,
        username: dbUser?.username || safeUser.username,
        avatar: dbUser?.profile?.avatar || safeUser.avatar,
        displayId: dbUser?.displayId || socket.data.displayId || null, // ✅ FIX
      };
      socket.data.userId = safeUser.id;

      const userId = safeUser.id;

      try {
        // ===============================
        // ✅ FETCH ROOM ONCE (IMPORTANT FIX)
        // ===============================
        const roomDoc = await Room.findOne({ roomId });

        // ===============================
        // 📝 SEND DESCRIPTION (FIXED)
        // ===============================
        socket.emit("room:description", {
          roomId,
          description: roomDoc?.description || "",
        });

        // ===============================
        // 🥊 SEND ACTIVE PK
        // ===============================
        if (roomDoc?.activePK) {
          const pk = await PKBattle.findById(roomDoc.activePK);
          if (pk && pk.status === "running") {
            socket.emit("pk:started", pk);
          }
        }

        // ===============================
        // 🎵 MUSIC INIT
        // ===============================
        roomManager.initRoom(roomId);
        await restoreMusicState(roomId);

        // ===============================
        // 👥 TRACK USERS
        // ===============================
        if (!roomUsers.has(roomId)) {
          roomUsers.set(roomId, new Set());
        }
        roomUsers.get(roomId).add(userId);

        console.log(`📍 ${safeUser.username} joined ${roomName}`);

        // ===============================
        // 🎥 VIDEO ROOM
        // ===============================
        let videoRoom = await VideoRoom.findOne({ roomId });

        if (!videoRoom) {
          videoRoom = await VideoRoom.create({
            roomId,
            hostId: userId,
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
                userId,
                role: "listener",
                isReceivingVideo: false,
                videoFPS: 0,
                videoLatency: 0,
                lastVideoFrameReceived: 0,
              },
            },
          },
        );

        // ===============================
        // 👥 USERS LIST
        // ===============================

        const sockets = await io.in(roomName).fetchSockets();

        // ✅ Collect user IDs
        const userIds = sockets
          .filter((s) => s.data.user)
          .map((s) => s.data.user.id);

        // ✅ Fetch users (including displayId)
        const users = await User.find({ _id: { $in: userIds } })
          .select("profile.frame profile.avatar displayId username")
          .lean();

        // ✅ Create fast lookup maps
        const userMap = new Map(users.map((u) => [u._id.toString(), u]));

        const frameMap = new Map(
          users.map((u) => [u._id.toString(), u.profile?.frame?.icon || null]),
        );

        const roomAvatarMap = new Map();
        if (roomDoc?.roomProfiles) {
          roomDoc.roomProfiles.forEach((p) => {
            roomAvatarMap.set(p.userId.toString(), p.avatar);
          });
        }

        // ✅ Build users list (FIXED displayId)
        const usersInRoom = sockets
          .map((s) => {
            const user = s.data.user;
            if (!user) return null;

            const userIdStr = user.id?.toString();
            const dbUser = userMap.get(userIdStr);
            const seatSnapshot = new Set(
              (seats.get(roomId) || []).map((id) => id.toString()),
            );
            return {
              id: user.id,
              username: user.username,
              avatar:
                roomAvatarMap.get(userIdStr) ||
                dbUser?.profile?.avatar ||
                user.avatar,

              // 🔥🔥 THIS IS THE MAIN FIX
              displayId: user.displayId || null,

              isWatcher: !seatSnapshot.has(s.data.userId?.toString()),
              isBackground: backgroundUsers.has(userIdStr),
              frame: frameMap.get(userIdStr) || null,
              mic: micStates.get(userIdStr) || {
                muted: false,
                speaking: false,
              },
            };
          })
          .filter(Boolean);

        // ✅ Broadcast updated users
        io.to(roomName).emit("room:users", usersInRoom);

        socket.to(roomName).emit("room:userJoined", {
          id: socket.data.user.id,
          displayId: socket.data.user.displayId, // ✅ FIXED
          username: socket.data.user.username,
          avatar: socket.data.user.avatar,
        });

        //room:seatCount
        socket.emit("room:seatCount", {
          roomId,
          seatCount: roomDoc?.seatCount || 12,
        });
        // ===============================
        // 💬 MESSAGES
        // ===============================
        socket.emit("room:messages", roomMessages.get(roomId) || []);

        // ===============================
        // 🎵 MUSIC STATE
        // ===============================
        const currentMusicState = roomManager.getState(roomId);
        const dbState = await MusicState.findOne({ roomId });

        socket.emit("room:musicState", {
          musicFile: currentMusicState.musicFile,
          isPlaying: currentMusicState.isPlaying,
          startedAt: currentMusicState.startedAt,
          playedBy: currentMusicState.playedBy,
          currentPosition: roomManager.getCurrentPosition(roomId),
          musicUrl: dbState?.musicUrl || null,
        });

        // ===============================
        // 🎥 VIDEO STATE
        // ===============================
        let currentTime = 0;

        if (videoRoom.video) {
          if (videoRoom.video.isPlaying && videoRoom.video.startedAt) {
            currentTime =
              (Date.now() - new Date(videoRoom.video.startedAt)) / 1000 +
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
        // 🎬 ENTRANCE EFFECT
        // ===============================
        try {
          const userDoc = await User.findById(userId)
            .select("username profile.avatar level profile.entranceEffect")
            .lean();

          const activeEntrance = await StoreGiftInventory.findOne({
            userId,
            effectType: "ENTRANCE",
            isActive: true,
            expiresAt: { $gt: new Date() },
          }).lean();

          const animationUrl =
            activeEntrance?.animationUrl || userDoc?.profile?.entranceEffect;

          if (animationUrl) {
            socket.to(roomName).emit("room:effect", {
              type: "ENTRANCE",
              userId,
              username: userDoc?.username || "User",
              avatar: userDoc?.profile?.avatar || null,
              level: userDoc?.level || 1,
              animationUrl,
              duration: 4,
            });
          }
        } catch (error) {
          console.error("❌ Entrance error:", error.message);
        }

        // ===============================
        // ⏱ EXP TIMER
        // ===============================
        if (!roomStayTimers.has(userId)) {
          const stayTimer = setInterval(
            async () => {
              await levelController.addPersonalExp(userId, 10, io);
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
    // 🎯 UPDATE ROOM SEAT COUNT
    // ===============================
    socket.on("room:seatCount:update", async ({ roomId, seatCount }) => {
      try {
        const userId = socket.data.userId;

        if (!userId) {
          return socket.emit("error", { message: "User not authenticated" });
        }

        const allowedSeats = [8, 10, 12];
        if (!allowedSeats.includes(seatCount)) {
          return socket.emit("error", { message: "Invalid seat count" });
        }

        const room = await Room.findOne({ roomId });

        if (!room) {
          return socket.emit("error", { message: "Room not found" });
        }

        if (room.host.toString() !== userId.toString()) {
          return socket.emit("error:permission", {
            message: "Only host can change seat count",
          });
        }

        if (room.seatCount === seatCount) return;

        room.seatCount = seatCount;
        await room.save();

        // ✅ FIXED (added roomId)
        io.to(`room:${roomId}`).emit("room:seatCount", {
          roomId,
          seatCount,
        });
      } catch (err) {
        console.error("❌ seatCount update error:", err);
      }
    });

    // ===============================
    // 📝 ROOM DESCRIPTION UPDATE
    // ===============================
    socket.on("room:description:update", async ({ roomId, description }) => {
      try {
        const userId = socket.data.userId;

        if (!roomId || typeof description !== "string") {
          return socket.emit("error", { message: "Invalid data" });
        }

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) {
          return socket.emit("error:permission", {
            message: "Only host/admin can update description",
          });
        }

        const cleanDesc = description.trim().slice(0, 150);
        if (!cleanDesc) {
          return socket.emit("error", {
            message: "Description cannot be empty",
          });
        }

        const room = await Room.findOneAndUpdate(
          { roomId },
          { description: cleanDesc },
          { new: true },
        );

        if (!room) return;

        // ✅ already correct (with roomId)
        io.to(`room:${roomId}`).emit("room:description", {
          roomId,
          description: room.description,
        });

        console.log("✅ Room description updated:", cleanDesc);
      } catch (err) {
        console.error("❌ room description error:", err.message);
      }
    });
    // ===============================
    // 🟡 BACKGROUND MODE (KEEP BUTTON)
    // ===============================
    socket.on("room:background", ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      backgroundUsers.set(userId.toString(), true);
      socket.data.isBackground = true;

      console.log("🟡 User moved to background:", userId);
    });
    // ===============================
    // 🟢 FOREGROUND (RETURN TO ROOM)
    // ===============================
    socket.on("room:foreground", ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId) return;

      backgroundUsers.delete(userId.toString());
      socket.data.isBackground = false;

      console.log("🟢 User back to foreground:", userId);
    });
    // ===============================
    // 🔴 FULL LEAVE ROOM
    // ===============================
    socket.on("room:leave", ({ roomId }) => {
      const userId = socket.data.userId;

      if (!userId || !roomId) return;
      // ✅ ADD THIS
      const roomSeats = seats.get(roomId) || [];
      seats.set(
        roomId,
        roomSeats.filter((id) => id !== userId),
      );
      backgroundUsers.delete(userId.toString());

      socket.leave(`room:${roomId}`);
      socket.data.isBackground = false;

      console.log("🔴 User fully left room:", userId);
    });
    // ===============================
    // 🥊 PK START (SOCKET BROADCAST)
    // ===============================
    socket.on("pk:start", async ({ roomId, pkId }) => {
      try {
        const userId = socket.data.userId;

        if (!userId || !roomId || !pkId) return;

        const room = await Room.findOne({ roomId });

        if (!room) {
          return socket.emit("pk:error", { message: "Room not found" });
        }

        // ✅ ONLY HOST ALLOWED
        if (!room.host || room.host.toString() !== userId.toString()) {
          return socket.emit("pk:error", {
            message: "Only host can start PK",
          });
        }

        const pk = await PKBattle.findById(pkId);
        if (!pk) {
          return socket.emit("pk:error", { message: "PK not found" });
        }

        console.log("🔥 Host starting PK:", pk._id);

        // Broadcast PK to room
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
        const gift = await Gift.findById(giftId).lean();
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

        // =========================
        // REMOVE SENDER (NORMAL FLOW)
        // =========================
        recipientIds = recipientIds.filter(
          (id) => id?.toString() !== fromUserId.toString(),
        );

        // =========================
        // 🔥 SELF SEND HANDLING
        // =========================
        let isSelfSend = false;

        if (recipientIds.length === 0) {
          recipientIds = [fromUserId];
          isSelfSend = true;
        } else {
          isSelfSend =
            recipientIds.length === 1 &&
            recipientIds[0].toString() === fromUserId.toString();
        }

        // ✅ FIX: override sendType locally
        const finalSendType = isSelfSend ? "self" : sendType;

        // =========================
        // 3️⃣ Cost Calculation
        // =========================
        const totalCost = gift.price * quantity * recipientIds.length;

        const sender = await User.findOneAndUpdate(
          { _id: fromUserId, coins: { $gte: totalCost } },
          { $inc: { coins: -totalCost } },
          { new: true },
        );

        if (!sender) {
          return socket.emit("gift:error", { message: "Not enough coins" });
        }

        // ==========================
        // 🎰 PROFIT / LOSS SYSTEM (FIXED FOR SELF SEND)
        // ==========================
        let luck = null;
        const amount = totalCost;

        if (amount >= 5000 && finalSendType !== "pk") {
          luck = calculateProfitLoss(amount);

          console.log("🎰 PROFIT/LOSS DEBUG:", {
            amount,
            isSelfSend,
            result: luck.result,
            percent: luck.percentage,
            coins: luck.coins,
          });

          if (luck.coins !== 0) {
            await User.findByIdAndUpdate(fromUserId, {
              $inc: { coins: luck.coins },
            });
          }
        }
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
          sendType: finalSendType,
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
          fromDisplayId: socket.data.displayId, // ✅ ADD
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          recipientIds,
          gift: {
            _id: gift._id,
            name: gift.name,
            icon: gift.icon,
            animationUrl: gift.animationUrl || gift.icon,
            price: gift.price,
            rarity: gift.rarity,
            effectType: gift.effectType,
          },
          quantity,
          sendType: finalSendType, // ✅ FIXED
          pkId: sendType === "pk" ? pkId : null,
        });

        // 🎰 Profit/Loss Animation
        if (luck && luck.coins !== 0) {
          io.to(`room:${roomId}`).emit("gift:luck", {
            userId: fromUserId,
            username: socket.data.username,
            coins: luck.coins,
            percentage: luck.percentage,
            result: luck.result,
          });
        }
        // =========================
        // 8️⃣ Success Response
        // =========================
        let finalBalance = sender.coins;

        if (luck && luck.coins !== 0) {
          finalBalance = sender.coins + luck.coins;
        }

        socket.emit("gift:success", {
          balance: finalBalance,
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
    // room:avatar:update
    socket.on("room:avatar:update", async ({ roomId, avatar }) => {
      try {
        const userId = socket.data.userId;

        if (!roomId || !avatar) return;

        const room = await Room.findOne({ roomId });
        if (!room) return;

        // Only host can change room avatar
        if (!room.host || room.host.toString() !== userId.toString()) {
          return socket.emit("error:permission", {
            message: "Only host can update room avatar",
          });
        }

        // ✅ FIX: ensure array exists
        if (!room.roomProfiles) {
          room.roomProfiles = [];
        }

        const userIdStr = userId.toString();

        // ✅ Find existing profile
        const existing = room.roomProfiles.find(
          (p) => p.userId.toString() === userIdStr,
        );

        if (existing) {
          existing.avatar = avatar;
        } else {
          room.roomProfiles.push({
            userId: userId,
            avatar,
          });
        }

        await room.save();

        // ✅ Broadcast update
        io.to(`room:${roomId}`).emit("room:avatar:updated", {
          userId: userIdStr,
          avatar,
        });

        console.log("✅ Room avatar updated:", { roomId, userIdStr, avatar });
      } catch (err) {
        console.error("❌ room:avatar:update error:", err.message);
      }
    });
    // ===============================
    // PK MANUAL END EVENTS
    // ===============================

    socket.on("pk:end", async ({ pkId, roomId }) => {
      try {
        const userId = socket.data.userId;

        const room = await Room.findOne({ roomId });

        if (!room || room.host.toString() !== userId.toString()) {
          return socket.emit("pk:error", {
            message: "Only host can end PK",
          });
        }

        await endPKInternal(pkId, io);
      } catch (err) {
        console.error("❌ pk:end error:", err);
      }
    });

    socket.on("pk:forceEnd", async ({ pkId, roomId }) => {
      try {
        const userId = socket.data.userId;

        if (!userId || !roomId) return;

        const room = await Room.findOne({ roomId });

        if (!room || room.host.toString() !== userId.toString()) {
          return socket.emit("pk:error", {
            message: "Only host can force end PK",
          });
        }

        await endPKInternal(pkId, io);
      } catch (err) {
        console.error("❌ pk:forceEnd error:", err);
      }
    });
    // ===============================
    // 🔽 LEAVE SEAT (GO TO AUDIENCE)
    // ===============================
    socket.on("room:leaveSeat", async ({ roomId }) => {
      const userId = socket.data.userId?.toString();
      if (!userId || !roomId) return;

      console.log("🪑 Leaving seat:", userId);

      // ✅ FORCE REMOVE FROM SEATS (STRING SAFE)
      let roomSeats = seats.get(roomId) || [];

      roomSeats = roomSeats
        .map((id) => id.toString())
        .filter((id) => id !== userId);

      seats.set(roomId, roomSeats);

      // ✅ UPDATE USER STATE
      socket.data.isWatcher = true;
      micStates.set(userId, { muted: true, speaking: false });

      // ✅ ALWAYS USE FRESH SNAPSHOT
      const seatSnapshot = new Set(roomSeats);

      const roomName = `room:${roomId}`;
      const sockets = await io.in(roomName).fetchSockets();

      const usersInRoom = sockets
        .map((s) => {
          if (!s.data.user) return null;

          const uid = s.data.userId?.toString();

          return {
            id: uid,
            username: s.data.user.username,
            avatar: s.data.user.avatar,
            displayId: s.data.user.displayId || null,

            // 🔥 CORE FIX: ALWAYS CHECK SNAPSHOT
            isWatcher: !seatSnapshot.has(uid),

            isBackground: backgroundUsers.has(uid),

            mic: micStates.get(uid) || {
              muted: true,
              speaking: false,
            },
          };
        })
        .filter(Boolean);

      // 🔥 IMPORTANT: BROADCAST FULL STATE
      io.to(roomName).emit("room:users", usersInRoom);

      // 🔥 EXTRA: FORCE REMOVE EVENT (UI SAFETY)
      io.to(roomName).emit("room:seat:removed", {
        userId,
      });

      console.log("✅ Seat removed globally:", userId);
    });

    socket.on("room:takeSeat", async ({ roomId }) => {
      const userId = socket.data.userId?.toString();
      if (!userId || !roomId) return;

      console.log("🪑 User taking seat:", userId);

      // ✅ UPDATE USER STATE
      socket.data.isWatcher = false;
      micStates.set(userId, { muted: false, speaking: false });

      // ✅ GET CURRENT SEATS
      let roomSeats = seats.get(roomId) || [];

      // ✅ STRING SAFE + PREVENT DUPLICATE
      roomSeats = roomSeats.map((id) => id.toString());

      if (!roomSeats.includes(userId)) {
        roomSeats.push(userId);
      }

      seats.set(roomId, roomSeats);

      // ✅ SNAPSHOT (CRITICAL FIX)
      const seatSnapshot = new Set(roomSeats);

      const roomName = `room:${roomId}`;
      const sockets = await io.in(roomName).fetchSockets();

      const usersInRoom = sockets
        .map((s) => {
          if (!s.data.user) return null;

          const uid = s.data.userId?.toString();

          return {
            id: uid,
            username: s.data.user.username,
            avatar: s.data.user.avatar,
            displayId: s.data.user.displayId || null,

            // 🔥 CORE FIX (same as leaveSeat)
            isWatcher: !seatSnapshot.has(uid),

            isBackground: backgroundUsers.has(uid),

            mic: micStates.get(uid) || {
              muted: false,
              speaking: false,
            },
          };
        })
        .filter(Boolean);

      // ✅ BROADCAST FULL STATE (SYNC ALL USERS)
      io.to(roomName).emit("room:users", usersInRoom);

      // ✅ OPTIONAL (UI trigger)
      io.to(roomName).emit("room:seat:taken", {
        userId,
      });

      console.log("✅ Seat taken synced:", userId);
    });

    // masage image part
    socket.on("message:image", ({ roomId, imageUrl, width, height }) => {
      const { userId, username, avatar } = socket.data;

      if (!roomId || !imageUrl) return;

      const message = {
        id: `${userId}-${Date.now()}`,
        type: "image",
        userId,
        displayId: socket.data.displayId, // ✅ ADD
        username,
        avatar,
        imageUrl,
        width,
        height,

        bubble: socket.data.profile?.bubble || null,
        frame: socket.data.profile?.frame || null,
        level: socket.data.profile?.level || 1,

        timestamp: new Date().toISOString(),
      };

      if (!roomMessages.has(roomId)) {
        roomMessages.set(roomId, []);
      }

      const messages = roomMessages.get(roomId);

      messages.push(message);

      // prevent memory overflow
      if (messages.length > 100) {
        messages.shift();
      }

      io.to(`room:${roomId}`).emit("message:receive", message);
    });

    /* =========================
   VIDEO CONTROLS (ALL USERS)
========================= */

    socket.on("video:play", ({ roomId, userId }) => {
      if (socket.data.isWatcher) return;
      if (!roomId) return;

      // ✅ socket only broadcasts (no DB write)
      io.to(`room:${roomId}`).emit("video:started", {
        startedBy: userId,
      });
    });

    socket.on("video:pause", ({ roomId }) => {
      if (socket.data.isWatcher) return;
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
      if (socket.data.isWatcher) return;
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
      if (socket.data.isWatcher) return;
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
      if (socket.data.isWatcher) return;
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
      if (socket.data.isWatcher) return;
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
      io.to(to.toString()).emit("call:offer", {
        from: socket.data.userId,
        offer,
      });
    });

    socket.on("call:answer", ({ to, answer }) => {
      io.to(to.toString()).emit("call:answer", {
        from: socket.data.userId,
        answer,
      });
    });

    socket.on("call:ice", ({ to, candidate }) => {
      io.to(to.toString()).emit("call:ice", {
        from: socket.data.userId,
        candidate,
      });
    });
    /* =========================
       CHAT
    ========================= */
    socket.on("message:send", async ({ roomId, text }) => {
      const { userId, username, avatar } = socket.data;

      if (!roomId || !text || !userId) return;

      // ✅ SAVE TO DB (ONLY ADD THIS)
      const newMessage = await Message.create({
        content: text,
        sender: userId,
        room: roomId,
      });

      // ✅ KEEP YOUR FULL STRUCTURE (IMPORTANT)
      const message = {
        id: `${userId}-${Date.now()}`, // keep your existing ID (no break)
        dbId: newMessage._id, // 🔥 ADD THIS (important for future fix)
        roomId,
        userId,
        displayId: socket.data.displayId,
        username,
        avatar,
        text,
        bubble: socket.data.profile?.bubble || null,
        frame: socket.data.profile?.frame || null,
        level: socket.data.profile?.level || 1,
        timestamp: new Date().toISOString(),

        // delete features
        deletedForEveryone: false,
        deletedFor: [],
      };

      if (!roomMessages.has(roomId)) {
        roomMessages.set(roomId, []);
      }

      const messages = roomMessages.get(roomId);
      messages.push(message);

      if (messages.length > 100) {
        messages.shift();
      }

      io.to(`room:${roomId}`).emit("message:receive", message);
    });

    socket.on("message:typing", ({ roomId, isTyping }) => {
      const { userId, username } = socket.data;
      if (!roomId || !userId) return;

      const roomName = `room:${roomId}`;

      if (!typingUsers.has(roomId)) typingUsers.set(roomId, new Set());

      const typingSet = typingUsers.get(roomId);

      if (isTyping) typingSet.add(userId);
      else typingSet.delete(userId);

      io.to(roomName).emit("message:typing", {
        userId,
        username,
        isTyping,
        typingUsers: Array.from(typingSet),
      });
    });

    socket.on("message:edit", async ({ roomId, messageId, newText }) => {
      const userId = socket.data.userId;

      if (!roomId || !messageId || !newText) return;

      let messages = roomMessages.get(roomId) || [];
      const localMsg = messages.find((m) => m.id === messageId);

      if (!localMsg) return;

      // =========================
      // ✅ SAFETY CHECK
      // =========================
      if (!localMsg.dbId) return;

      const msg = await Message.findById(localMsg.dbId);

      if (!msg) return;

      // =========================
      // ❌ PREVENT EDIT AFTER DELETE
      // =========================
      if (msg.isDeletedForEveryone) {
        return socket.emit("error", {
          message: "Cannot edit deleted message",
        });
      }

      // =========================
      // ❌ ONLY SENDER CAN EDIT
      // =========================
      if (msg.sender.toString() !== userId.toString()) {
        return socket.emit("error", {
          message: "You can only edit your own message",
        });
      }

      // =========================
      // ✅ UPDATE DB
      // =========================
      msg.content = newText;
      await msg.save();

      // =========================
      // ✅ UPDATE MEMORY
      // =========================
      messages = messages.map((m) => {
        if (m.id === messageId) {
          return {
            ...m,
            text: newText,
            edited: true,
          };
        }
        return m;
      });

      roomMessages.set(roomId, messages);

      // =========================
      // 📡 EMIT UPDATE
      // =========================
      io.to(`room:${roomId}`).emit("message:edited", {
        messageId,
        newText,
      });

      console.log("✏️ Message edited:", messageId);
    });

    socket.on("message:delete", async ({ roomId, messageId, type }) => {
      const userId = socket.data.userId;

      if (!roomId || !messageId) return;

      let messages = roomMessages.get(roomId) || [];
      const localMsg = messages.find((m) => m.id === messageId);

      if (!localMsg) return;

      // =========================
      // ✅ FIND DB MESSAGE
      // =========================
      if (!localMsg.dbId) return;

      const msg = await Message.findById(localMsg.dbId);

      if (!msg) return;

      // =========================
      // ✅ DELETE FOR ME
      // =========================
      if (type === "me") {
        if (!msg.deletedFor.includes(userId)) {
          msg.deletedFor.push(userId);
          await msg.save();
        }

        // MEMORY UPDATE
        messages = messages.map((m) => {
          if (m.id === messageId) {
            return {
              ...m,
              deletedFor: [...(m.deletedFor || []), userId],
            };
          }
          return m;
        });

        roomMessages.set(roomId, messages);

        socket.emit("message:deleted:me", { messageId });
        return;
      }

      // =========================
      // ✅ DELETE FOR EVERYONE
      // =========================
      if (type === "everyone") {
        if (msg.sender.toString() !== userId.toString()) {
          return socket.emit("error", {
            message: "Only sender can delete",
          });
        }

        msg.isDeletedForEveryone = true;
        msg.content = "🚫 This message was deleted";
        msg.deletedAt = new Date();

        await msg.save();

        // MEMORY UPDATE
        messages = messages.map((m) => {
          if (m.id === messageId) {
            return {
              ...m,
              text: "🚫 This message was deleted",
              deletedForEveryone: true,
            };
          }
          return m;
        });

        roomMessages.set(roomId, messages);

        io.to(`room:${roomId}`).emit("message:deleted:everyone", {
          messageId,
          text: "🚫 This message was deleted",
        });
      }
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
          fromDisplayId: socket.data.displayId, // ✅ ADD
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
          displayId: s.data.displayId, // ✅ ADD THIS
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
      const userId = socket.data.userId;

      const room = await getRoomSafe(roomId);
      if (!room || !room.host || room.host.toString() !== userId.toString()) {
        return socket.emit("error:permission", {
          message: "Only host can invite",
        });
      }

      const targetSocket = onlineUsers.get(toUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("room:invited", {
          roomId,
          fromUserId: userId,
          fromUsername: socket.data.username,
        });
      }
    });

    // LOCK SEAT
    socket.on("room:seat:lock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;

      const room = await getRoomSafe(roomId);

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission");

      // ✅ FIXED VALIDATION
      if (!room || seatNumber < 1 || seatNumber > room.seatCount) {
        return socket.emit("error", { message: "Invalid seat number" });
      }

      await Room.updateOne(
        { roomId },
        { $addToSet: { lockedSeats: seatNumber } },
      );

      io.to(`room:${roomId}`).emit("room:seat:locked", { seatNumber });
    });

    // UNLOCK SEAT
    socket.on("room:seat:unlock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const room = await getRoomSafe(roomId);

      // ✅ FIX: prevent crash + invalid seat
      if (!room || seatNumber < 1 || seatNumber > room.seatCount) {
        return socket.emit("error", { message: "Invalid seat number" });
      }

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) {
        return socket.emit("error:permission", {
          message: "Not host or admin",
        });
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

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission");

      micStates.set(targetUserId, { muted: true, speaking: false });

      io.to(`room:${roomId}`).emit("mic:update", {
        userId: targetUserId,
        muted: true,
        speaking: false,
      });

      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("mic:forceMuted");
      }
    });

    // MUTE EVERYONE
    socket.on("room:mic:muteAll", async ({ roomId }) => {
      const userId = socket.data.userId;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission");

      const sockets = await io.in(`room:${roomId}`).fetchSockets();

      sockets.forEach((s) => {
        const uid = s.data.userId;
        if (!uid) return;

        micStates.set(uid, { muted: true, speaking: false });
      });

      io.to(`room:${roomId}`).emit("room:mic:mutedAll");
    });

    // LOCK ALL SEATS
    socket.on("room:seats:lockAll", async ({ roomId }) => {
      const userId = socket.data.userId;

      const room = await getRoomSafe(roomId);

      // ✅ FIX: prevent crash
      if (!room) {
        return socket.emit("error", { message: "Room not found" });
      }

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission");

      // ✅ dynamic seats (already correct)
      const allSeats = Array.from({ length: room.seatCount }, (_, i) => i + 1);

      room.lockedSeats = allSeats;
      await room.save();

      io.to(`room:${roomId}`).emit("room:seats:lockedAll", {
        lockedSeats: allSeats,
      });
    });

    // GIVE ADMIN (ONLY HOST CAN DO THIS)
    socket.on("room:giveAdmin", async ({ roomId, targetUserId }) => {
      const userId = socket.data.userId;

      const room = await getRoomSafe(roomId);
      if (!room || !room.host || room.host.toString() !== userId.toString()) {
        return socket.emit("error:permission", {
          message: "Only host can assign admin",
        });
      }

      await Room.updateOne({ roomId }, { $addToSet: { admins: targetUserId } });

      io.to(`room:${roomId}`).emit("room:adminAdded", {
        userId: targetUserId,
      });
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", async () => {
      const { roomId, userId, user } = socket.data;
      if (roomId && userId) {
        const roomSeats = seats.get(roomId) || [];
        seats.set(
          roomId,
          roomSeats.filter((id) => id !== userId),
        );
      }
      try {
        // 🔥🔥🔥 MOST IMPORTANT FIX
        if (socket.data.isBackground) {
          console.log("🟡 Background user disconnect ignored:", userId);
          return;
        }

        if (userId) {
          onlineUsers.delete(userId);
          micStates.delete(userId);

          // ===============================
          // 🔥 CLEAR LEVEL TIMERS (SAFE)
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

          // 🔥 STOP MUSIC IF DJ LEFT
          if (
            roomId &&
            musicState.playedBy &&
            musicState.playedBy.toString() === userId.toString()
          ) {
            console.log("🎵 DJ left room, stopping music permanently");

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

            io.to(`room:${roomId}`).emit("music:stopped", {
              reason: "dj_left",
            });
          }
        }

        if (roomId && user) {
          socket.to(`room:${roomId}`).emit("room:userLeft", {
            userId: user.id,
          });
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
module.exports.startPKTimer = startPKTimer;
