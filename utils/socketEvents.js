const roomManager = require("../utils/musicRoomManager");
const VideoRoom = require("../models/videoRoom");
const Leaderboard = require("../models/trophyLeaderBoard");
const MusicState = require("../models/musicState");
const restoreMusicState = require("../utils/restoreMusicState");
const levelController = require("../controllers/levelController");
const trophyController = require("../controllers/trophyController");
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
const RoomInvite = require("../models/roomInvite");
const Block = require("../models/blockUsers");
const ProfitLossConfig = require("../models/profitLossConfig");
async function getRoomSafe(roomId) {
  return await Room.findOne({ roomId });
}
// pkId -> timeoutId
const pkTimers = new Map();
const backgroundUsers = new Map(); // userId -> true
const seats = new Map(); // ✅ roomId -> [userIds]
const userSockets = new Map();

// Helper functions to support multiple sockets per user (backwards compatible)
function addUserSocket(userId, socketId) {
  if (!userId || !socketId) return;
  const key = userId.toString();
  const existing = userSockets.get(key);
  if (!existing) {
    // store as Set
    userSockets.set(key, new Set([socketId]));
    return;
  }
  if (typeof existing === "string") {
    // migrate legacy single value to Set
    const s = new Set([existing, socketId]);
    userSockets.set(key, s);
    return;
  }
  // existing is a Set
  existing.add(socketId);
}

function removeUserSocket(userId, socketId) {
  if (!userId || !socketId) return;
  const key = userId.toString();
  const existing = userSockets.get(key);
  if (!existing) return;
  if (typeof existing === "string") {
    // legacy single value
    if (existing === socketId) userSockets.delete(key);
    return;
  }
  // Set
  existing.delete(socketId);
  if (existing.size === 0) userSockets.delete(key);
}

function getUserSocketIds(userId) {
  if (!userId) return [];
  const key = userId.toString();
  const existing = userSockets.get(key);
  if (!existing) return [];
  if (typeof existing === "string") return [existing];
  return Array.from(existing);
}

// Permission Helper (Host/Admin Check)
// Permission Helper (Host/Admin Check) - FIXED

async function isHostOrAdmin(roomId, userId) {
  if (!roomId || !userId) return false;
  const room = await Room.findOne({ roomId });

  if (!room) return false;

  const uid = userId.toString();

  // ✅ Host check
  if (room.host && room.host.toString() === uid) return true;

  // ✅ Admin check
  if (Array.isArray(room.admins)) {
    if (room.admins.some((id) => id && id.toString() === uid)) {
      return true;
    }
  }

  return false;
}

// ✅ NEW: Strict Host Check
async function isHost(roomId, userId) {
  if (!roomId || !userId) return false;
  const room = await Room.findOne({ roomId });
  if (!room || !room.host) return false;
  return room.host.toString() === userId.toString();
}

// ✅ NEW: Broadcast Watcher Count Helper
async function broadcastWatcherCount(roomId, io) {
  if (!roomId) return;
  const roomName = `room:${roomId}`;
  const sockets = await io.in(roomName).fetchSockets();
  const seatSnapshot = new Set(
    (seats.get(roomId) || []).map((id) => id.toString()),
  );

  const watcherCount = sockets.filter(s => {
    const userIdStr = s.data.userId?.toString();
    return userIdStr && !seatSnapshot.has(userIdStr);
  }).length;

  io.to(roomName).emit("room:watcherCount", {
    roomId,
    count: watcherCount,
  });
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
    winnerDisplayId: pk.winner
      ? (pk.winner.toString() === leftId ? leftUser?.displayId : rightUser?.displayId)
      : null,
  });
}

module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const deafenStates = new Map(); // userId -> boolean (sound status)
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room

  // ✅ HELPER: Broadcast Room Users (Full State)
  const broadcastRoomUsers = async (roomId) => {
    try {
      const roomName = `room:${roomId}`;
      const roomDoc = await Room.findOne({ roomId }).lean();
      if (!roomDoc) return [];

      const sockets = await io.in(roomName).fetchSockets();
      const userIds = sockets.map((s) => s.data.userId?.toString()).filter(Boolean);

      const users = await User.find({ _id: { $in: userIds } })
        .select("displayId username profile.avatar profile.frame profile.bubble country gender age level")
        .lean();

      const userMap = new Map(users.map((u) => [u._id.toString(), u]));
      const seatSnapshot = new Set((seats.get(roomId) || []).map((id) => id.toString()));

      const roomAvatarMap = new Map();
      if (roomDoc.roomProfiles) {
        roomDoc.roomProfiles.forEach((p) => {
          roomAvatarMap.set(p.userId.toString(), p.avatar);
        });
      }

      const admins = new Set((roomDoc.admins || []).map((id) => id.toString()));
      const hostId = roomDoc.host?.toString();

      const usersInRoom = sockets
        .map((s) => {
          const userIdStr = s.data.userId?.toString();
          if (!userIdStr) return null;

          const dbUser = userMap.get(userIdStr);

          return {
            id: userIdStr,
            username: dbUser?.username || s.data.username || "User",
            avatar:
              roomAvatarMap.get(userIdStr) ||
              dbUser?.profile?.avatar ||
              s.data.avatar ||
              null,
            displayId: dbUser?.displayId || s.data.displayId || null,
            isWatcher: !seatSnapshot.has(userIdStr),
            isBackground: backgroundUsers.has(userIdStr),
            isAdmin: admins.has(userIdStr),
            isHost: userIdStr === hostId,
            frame: dbUser?.profile?.frame?.icon || null,
            bubble: dbUser?.profile?.bubble || null,
            level: dbUser?.level?.personal?.level || 1,
            country: dbUser?.country || "Unknown",
            gender: dbUser?.gender || "Other",
            age: dbUser?.age || 18,
            mic: micStates.get(userIdStr) || {
              muted: false,
              speaking: false,
            },
            deafened: deafenStates.get(userIdStr) || false,
            soundMuted: deafenStates.get(userIdStr) || false,
          };
        })
        .filter(Boolean);

      io.to(roomName).emit("room:users", usersInRoom);
      return usersInRoom;
    } catch (err) {
      console.error("❌ broadcastRoomUsers error:", err.message);
      return [];
    }
  };

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

      addUserSocket(userId, socket.id);

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
        .select("profile.bubble profile.frame level displayId country gender age")
        .lean();
      socket.data.displayId = user?.displayId; // ✅ ADD THIS LINE
      socket.data.displayId = user?.displayId; // ✅ REQUIRED
      socket.data.profile = {
        bubble: user?.profile?.bubble || null,
        frame: user?.profile?.frame?.icon || null,
        level: user?.level?.personal?.level || 1,
        country: user?.country || "Unknown",
        gender: user?.gender || "Other",
        age: user?.age || 18,
      };
    });

    /* =========================
   ROOM WATCH (AUDIENCE MODE)
========================= */
    socket.on("room:watch", async ({ roomId, user, password }) => {
      if (!roomId) return;

      const safeUser = user || socket.data.user;
      if (!safeUser || !safeUser.id) {
        console.error("❌ room:watch without user identity", { roomId });
        return;
      }

      const userId = safeUser.id;
      const roomName = `room:${roomId}`;
      socket.join(roomName);

      socket.data.roomId = roomId;
      socket.data.userId = userId;
      socket.data.isWatcher = true;

      // ⭐ FETCH FULL USER (for metadata/displayId)
      const dbUser = await User.findById(userId)
        .select("displayId username profile.avatar profile.frame profile.bubble country gender age level")
        .lean();

      socket.data.user = {
        id: userId,
        username: dbUser?.username || safeUser.username || "User",
        avatar: dbUser?.profile?.avatar || safeUser.avatar || null,
        displayId: dbUser?.displayId || socket.data.displayId || null,
        level: dbUser?.level?.personal?.level || 1,
        country: dbUser?.country || "Unknown",
        gender: dbUser?.gender || "Other",
        age: dbUser?.age || 18,
        bubble: dbUser?.profile?.bubble || null,
        frame: dbUser?.profile?.frame?.icon || null,
      };

      console.log("👀 User watching room:", { roomId, userId, username: socket.data.user.username });

      try {
        // ===============================
        // ✅ FETCH & CHECK ROOM
        // ===============================
        const roomDoc = await Room.findOne({ roomId });
        if (!roomDoc) {
          return socket.emit("room:error", { message: "Room not found" });
        }

        // ❌ BLOCKED USER CHECK
        if (roomDoc.blockedUsers && roomDoc.blockedUsers.some(id => id.toString() === userId.toString())) {
          return socket.emit("room:error", { message: "You are blocked from this room" });
        }

        // ===============================
        // 👥 TRACK USERS (Consistency with room:join)
        // ===============================
        if (!roomUsers.has(roomId)) {
          roomUsers.set(roomId, new Set());
        }
        roomUsers.get(roomId).add(userId.toString());

        const alreadyJoined = roomDoc.participants.some(
          (p) => p.user.toString() === userId.toString(),
        );

        if (!alreadyJoined) {
          const hostId = roomDoc.host?.toString();
          const creatorId = roomDoc.creator?.toString();
          const userIdString = userId.toString();
          if (roomDoc.isLocked && hostId !== userIdString && creatorId !== userIdString) {
            if (!password || password !== roomDoc.password) {
              return socket.emit("room:error", {
                message: "Incorrect or missing password for this room",
                isLocked: true,
              });
            }
          }

          roomDoc.currentUsers += 1;
          roomDoc.lastActivityAt = new Date();
          roomDoc.participants.push({
            user: userId,
            role: roomDoc.host.toString() === userId.toString() ? "host" : "listener",
            avatar: socket.data.user.avatar,
            joinedAt: new Date(),
          });
          await roomDoc.save();
        } else {
          // Even if already joined, update currentUsers count if they were not active? 
          // (room:join logic incremented it, so we should too if we want parity)
          // But usually room:watch is used when re-entering or as a passive mode.
        }

        // ✅ BROADCAST USERS (REFACTORED)
        const usersInRoom = await broadcastRoomUsers(roomId);

        // ✅ DIRECT SEND FOR IMMEDIATE FEEDBACK
        socket.emit("room:users", usersInRoom);

        // ✅ Broadcast Watcher Count
        await broadcastWatcherCount(roomId, io);

        /* ===== MESSAGES ===== */
        const rIdStr = roomId.toString();
        socket.emit("room:messages", roomMessages.get(rIdStr) || []);

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
          seatCount: roomDoc?.seatCount || 10,
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
    socket.on("room:join", async ({ roomId, user, password }) => {
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
      socket.data.hasLeftRoom = false;
      // ✅ ALWAYS JOIN AS WATCHER
      socket.data.isWatcher = true;

      // ❌ DO NOT ADD TO SEATS HERE
      // 🔥 attach displayId into user object
      const dbUser = await User.findById(safeUser.id)
        .select("displayId username profile.avatar profile.frame profile.bubble country gender age level")
        .lean();

      socket.data.user = {
        id: safeUser.id,
        username: dbUser?.username || safeUser.username,
        avatar: dbUser?.profile?.avatar || safeUser.avatar,
        displayId: dbUser?.displayId || socket.data.displayId || null, // ✅ FIX
        level: dbUser?.level?.personal?.level || 1,
        country: dbUser?.country || "Unknown",
        gender: dbUser?.gender || "Other",
        age: dbUser?.age || 18,
        bubble: dbUser?.profile?.bubble || null,
        frame: dbUser?.profile?.frame?.icon || null,
      };
      socket.data.userId = safeUser.id;

      const userId = safeUser.id;

      try {
        // ===============================
        // ✅ FETCH ROOM ONCE (IMPORTANT FIX)
        // ===============================
        const roomDoc = await Room.findOne({ roomId });
        // ❌ ROOM NOT FOUND
        if (!roomDoc) {
          return socket.emit("room:error", {
            message: "Room not found",
          });
        }

        // ❌ BLOCKED USER
        if (roomDoc.blockedUsers && roomDoc.blockedUsers.some(id => id.toString() === userId.toString())) {
          return socket.emit("room:error", {
            message: "You are blocked from this room",
          });
        }

        // ❌ ROOM ENDED
        if (roomDoc.status === "ended") {
          return socket.emit("room:error", {
            message: "Room ended",
          });
        }

        // ❌ HOST LEFT
        if (roomDoc.status === "host_left") {
          return socket.emit("room:expired", {
            message: "Host left the room",
          });
        }

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
        const alreadyJoined = roomDoc.participants.some(
          (p) => p.user.toString() === userId.toString(),
        );

        if (!alreadyJoined) {
          const hostId = roomDoc.host?.toString();
          const creatorId = roomDoc.creator?.toString();
          const userIdString = userId.toString();
          if (roomDoc.isLocked && hostId !== userIdString && creatorId !== userIdString) {
            if (!password || password !== roomDoc.password) {
              return socket.emit("room:error", {
                message: "Incorrect or missing password for this room",
                isLocked: true,
              });
            }
          }

          roomDoc.currentUsers += 1;

          roomDoc.lastActivityAt = new Date();

          roomDoc.participants.push({
            user: userId,

            role:
              roomDoc.host.toString() === userId.toString()
                ? "host"
                : "listener",

            avatar: dbUser?.profile?.avatar || safeUser.avatar,

            joinedAt: new Date(),
          });

          await roomDoc.save();
        }

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

        const existingVideoParticipant = videoRoom.participants.some(
          (p) => p.userId.toString() === userId.toString(),
        );

        if (!existingVideoParticipant) {
          await VideoRoom.findOneAndUpdate(
            { roomId },
            {
              $push: {
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
        }

        // ✅ BROADCAST USERS (REFACTORED)
        await broadcastRoomUsers(roomId);

        // ✅ Broadcast Watcher Count
        await broadcastWatcherCount(roomId, io);

        socket.to(roomName).emit("room:userJoined", {
          id: socket.data.user.id,
          displayId: socket.data.user.displayId, // ✅ FIXED
          username: socket.data.user.username,
          avatar: socket.data.user.avatar,
        });

        //room:seatCount
        socket.emit("room:seatCount", {
          roomId,
          seatCount: roomDoc?.seatCount || 10,
        });
        // ===============================
        // 💬 MESSAGES
        // ===============================
        const rIdStr = roomId.toString();
        socket.emit("room:messages", roomMessages.get(rIdStr) || []);

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
    socket.on("room:seatCount:update", async (data, arg2) => {
      try {
        let roomId, seatCount;

        // ✅ Support both ({roomId, seatCount}) and (roomId, seatCount)
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          roomId = data.roomId;
          seatCount = data.seatCount;
        } else {
          roomId = data;
          seatCount = arg2;
        }

        console.log("📥 [SeatCount Update] Received:", { roomId, seatCount });

        if (!roomId) {
          return socket.emit("error", { message: "Missing Room ID" });
        }

        const userId = socket.data.userId;
        if (!userId) {
          return socket.emit("error", { message: "User not authenticated" });
        }

        const parsedSeatCount = Number(seatCount);
        const allowedSeats = [5, 10, 15, 20];

        if (isNaN(parsedSeatCount) || !allowedSeats.includes(parsedSeatCount)) {
          console.error("❌ Invalid seat count attempt:", seatCount);
          return socket.emit("error", { message: "Invalid seat count" });
        }

        const room = await Room.findOne({ roomId });
        if (!room) {
          return socket.emit("error", { message: "Room not found" });
        }

        const allowed = await isHost(roomId, userId);
        if (!allowed) {
          return socket.emit("error:permission", {
            message: "Only host can change seat count",
          });
        }

        if (room.seatCount === parsedSeatCount) return;

        room.seatCount = parsedSeatCount;
        await room.save();

        // ✅ FIXED (added roomId)
        io.to(`room:${roomId}`).emit("room:seatCount", {
          roomId,
          seatCount: parsedSeatCount,
        });
      } catch (err) {
        console.error("❌ seatCount update error:", err);
      }
    });

    // ===============================
    // 📝 ROOM DESCRIPTION UPDATE
    // ===============================
    socket.on("room:description:update", async (data, arg2) => {
      try {
        let roomId, description;

        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          roomId = data.roomId;
          description = data.description;
        } else {
          roomId = data;
          description = arg2;
        }

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
    socket.on("room:leave", async ({ roomId }) => {
      try {
        const userId = socket.data.userId;

        if (!userId || !roomId) return;

        // ✅ PREVENT DOUBLE CLEANUP
        if (socket.data.hasLeftRoom) return;

        socket.data.hasLeftRoom = true;

        deafenStates.delete(userId.toString());
        micStates.delete(userId.toString());
        micStates.delete(userId);

        const room = await Room.findOne({ roomId });

        if (!room) return;

        // =========================
        // REMOVE FROM SEATS
        // =========================
        const roomSeats = seats.get(roomId) || [];

        seats.set(
          roomId,
          roomSeats.filter((id) => id.toString() !== userId.toString()),
        );

        // =========================
        // UPDATE ROOM USERS
        // =========================
        room.currentUsers = Math.max(0, room.currentUsers - 1);
        if (roomUsers.has(roomId)) {
          roomUsers.get(roomId).delete(userId.toString());
        }

        room.lastActivityAt = new Date();

        // =========================
        // REMOVE PARTICIPANT
        // =========================
        room.participants = room.participants.filter(
          (p) => p.user.toString() !== userId.toString(),
        );

        await VideoRoom.updateOne(
          { roomId },
          {
            $pull: {
              participants: {
                userId,
              },
            },
          },
        );
        // =========================
        // HOST LEFT
        // =========================
        if (room.host && room.host.toString() === userId.toString()) {
          room.hostOnline = false;

          room.hostLeftAt = new Date();

          if (!room.isHelpRoom) {
            room.status = "host_left";
            room.isActive = false;
          }

          io.to(`room:${roomId}`).emit("room:hostLeft", {
            roomId,
          });

          console.log("🚨 Host left:", roomId);
        }

        // =========================
        // EMPTY ROOM
        // =========================
        if (room.currentUsers <= 0) {
          // Keep help rooms or admin-created rooms persistent
          if (room.isHelpRoom || room.createdByAdmin) {
            // Keep help room active but clear participants list
            room.status = "active";
            room.isActive = true;
            room.participants = [];
            await room.save();

            await VideoRoom.updateOne(
              { roomId },
              { $set: { participants: [], "video.isPlaying": false } }
            );

            seats.delete(roomId);
            roomUsers.delete(roomId);
            typingUsers.delete(roomId);

            socket.leave(`room:${roomId}`);
            console.log("ℹ️ Help/Admin Room kept active on leave:", roomId);
            return;
          } else {
            room.status = "ended";

            await room.save();

            await Room.deleteOne({ roomId });

            await VideoRoom.deleteOne({ roomId });

            await MusicState.deleteOne({ roomId });

            roomManager.stopMusic(roomId);

            const rIdStr = roomId.toString();
            seats.delete(roomId); // seats Map seems to use roomId as-is in some places, but let's be safe
            roomUsers.delete(roomId);
            roomMessages.delete(rIdStr);
            typingUsers.delete(roomId);

            backgroundUsers.delete(userId.toString());

            io.to(`room:${roomId}`).emit("room:deleted");

            socket.leave(`room:${roomId}`);

            console.log("🗑 Room deleted:", roomId);

            return;
          }
        }

        // =========================
        // SAVE ROOM
        // =========================
        await room.save();

        backgroundUsers.delete(userId.toString());

        socket.leave(`room:${roomId}`);

        socket.data.isBackground = false;

        console.log("🔴 User left room:", userId);
      } catch (err) {
        console.error("❌ room:leave error:", err);
      }
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

        // ✅ BLOCK CHECK
        if (room.blockedUsers?.some(id => id.toString() === fromUserId.toString())) {
          return socket.emit("gift:error", { message: "You are blocked from this room" });
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

        // Fetch dynamic min coins required from ProfitLossConfig database
        let minCoins = 5000;
        try {
          const plConfig = await ProfitLossConfig.findOne().lean();
          if (plConfig && typeof plConfig.minCoinsRequired === "number") {
            minCoins = plConfig.minCoinsRequired;
          }
        } catch (e) {
          console.error("Error fetching minCoinsRequired from DB:", e);
        }

        if (amount >= minCoins && finalSendType !== "pk") {
          luck = await calculateProfitLoss(amount);

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
        const recipientsList = await User.find({ _id: { $in: recipientIds } })
          .select("username profile.avatar displayId")
          .lean();

        const recipients = recipientsList.map(r => ({
          userId: r._id,
          username: r.username,
          avatar: r.profile?.avatar,
          displayId: r.displayId
        }));

        io.to(`room:${roomId}`).emit("gift:received", {
          fromUserId,
          fromDisplayId: socket.data.displayId, // ✅ ADD
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          recipientIds,
          recipients, // ✅ ADDED populated recipients list
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

        // 🔔 Broad-cast simple notification details
        io.to(`room:${roomId}`).emit("gift:notification", {
          fromUserId,
          fromUsername: socket.data.username,
          fromAvatar: socket.data.avatar,
          fromDisplayId: socket.data.displayId,
          recipients,
          gift: {
            _id: gift._id,
            name: gift.name,
            icon: gift.icon,
            animationUrl: gift.animationUrl || gift.icon,
            price: gift.price,
          },
          quantity,
          text: `${socket.data.username} sent ${gift.name} x${quantity} to ${recipients.map(r => r.username).join(", ")}`
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

        // =========================
        // 🏆 UPDATE TROPHY / LEADERBOARD
        // =========================
        await trophyController.updateLeaderboardOnGift(fromUserId, totalCost);
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
          displayId: socket.data.displayId,
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

      // 🔥 BROADCAST FULL STATE
      await broadcastRoomUsers(roomId);

      // 🔥 EXTRA: FORCE REMOVE EVENT (UI SAFETY)
      io.to(`room:${roomId}`).emit("room:seat:removed", {
        userId,
        displayId: socket.data.displayId,
      });

      console.log("✅ Seat removed globally:", userId);
    });

    socket.on("room:takeSeat", async (payload) => {
      const { roomId, seatNumber, seatIndex } = payload || {};
      const userId = socket.data.userId?.toString();
      if (!userId || !roomId) return;

      console.log("🪑 User taking seat:", userId, "payload:", payload);

      try {
        // Fetch the room once
        const room = await Room.findOne({ roomId }).select("host admins lockedSeats seatCount").lean();
        if (!room) {
          socket.emit("error", { message: "Room not found" });
          socket.emit("room:error", { message: "Room not found" });
          return;
        }

        // Check if user is host or admin (they can take any seat, even locked ones)
        const uid = userId.toString();
        const isHost = room.host && room.host.toString() === uid;
        const isAdmin = Array.isArray(room.admins) && room.admins.some((id) => id && id.toString() === uid);
        const isHostOrAdminUser = isHost || isAdmin;

        // ✅ GET CURRENT SEATS
        let roomSeats = seats.get(roomId) || [];
        roomSeats = roomSeats.map((id) => id.toString());

        if (!isHostOrAdminUser) {
          const lockedSeatsList = room.lockedSeats || [];

          // Determine target seat number (1-based index)
          let targetSeat = null;
          if (seatNumber !== undefined && seatNumber !== null) {
            targetSeat = Number(seatNumber);
          } else if (seatIndex !== undefined && seatIndex !== null) {
            targetSeat = Number(seatIndex) + 1;
          }

          if (targetSeat !== null) {
            if (lockedSeatsList.includes(targetSeat)) {
              console.log(`❌ Blocked user ${userId} from locked seat ${targetSeat}`);
              socket.emit("error", { message: "This seat is locked" });
              socket.emit("error:permission", { message: "This seat is locked" });
              socket.emit("room:error", { message: "This seat is locked" });
              return;
            }
          } else {
            // If no specific seat is requested, check if the sequential seat they would occupy is locked,
            // or if all seats are locked.
            const nextSeatNumber = roomSeats.length + 1;
            if (lockedSeatsList.includes(nextSeatNumber) || lockedSeatsList.length >= (room.seatCount || 10)) {
              console.log(`❌ Blocked user ${userId} from joining seats (all/next seat locked). Locked count: ${lockedSeatsList.length}`);
              socket.emit("error", { message: "Seats are locked" });
              socket.emit("error:permission", { message: "Seats are locked" });
              socket.emit("room:error", { message: "Seats are locked" });
              return;
            }
          }
        }

        // ✅ UPDATE USER STATE
        socket.data.isWatcher = false;
        micStates.set(userId, { muted: false, speaking: false });

        if (!roomSeats.includes(userId)) {
          roomSeats.push(userId);
        }

        seats.set(roomId, roomSeats);

        // ✅ BROADCAST FULL STATE
        await broadcastRoomUsers(roomId);

        // ✅ OPTIONAL (UI trigger)
        io.to(`room:${roomId}`).emit("room:seat:taken", {
          userId,
          displayId: socket.data.displayId,
        });

        console.log("✅ Seat taken synced:", userId);
      } catch (err) {
        console.error("❌ room:takeSeat error:", err);
      }
    });

    // ===============================
    // 🔎 SEARCH BY ROOM ID OR USER ID
    // Payload: { type: 'room'|'user', id: string }
    // Emits: 'search:result' with { success, type, data }
    // ===============================
    socket.on("search:lookup", async (payload) => {
      try {
        if (!payload || typeof payload !== "object") {
          return socket.emit("search:result", { success: false, message: "Invalid payload" });
        }

        const { type, id } = payload;
        if (!type || !id) {
          return socket.emit("search:result", { success: false, message: "Missing type or id" });
        }

        if (type === "room") {
          const roomDoc = await Room.findOne({ roomId: id }).lean();
          if (!roomDoc) {
            return socket.emit("search:result", { success: true, type: "room", data: null });
          }

          const hostId = roomDoc.host?.toString();
          let host = null;
          if (hostId) {
            host = await User.findById(hostId)
              .select("_id username displayId profile.avatar")
              .lean();
          }

          return socket.emit("search:result", {
            success: true,
            type: "room",
            data: {
              room: roomDoc,
              host,
            },
          });
        }

        if (type === "user") {
          let userDoc = null;

          if (mongoose.Types.ObjectId.isValid(id)) {
            userDoc = await User.findById(id)
              .select("_id username displayId profile.avatar country gender age level")
              .lean();
          }

          if (!userDoc) {
            userDoc = await User.findOne({
              $or: [{ displayId: id }, { username: id }],
            })
              .select("_id username displayId profile.avatar country gender age level")
              .lean();
          }

          return socket.emit("search:result", { success: true, type: "user", data: userDoc || null });
        }

        return socket.emit("search:result", { success: false, message: "Unknown type" });
      } catch (err) {
        console.error("❌ search:lookup error:", err.message);
        return socket.emit("search:result", { success: false, message: "Search failed" });
      }
    });

    // masage image part
    socket.on("message:image", async ({ roomId, imageUrl, width, height }) => {
      const { userId, username, avatar } = socket.data;

      if (!roomId || !imageUrl) return;

      // ✅ BLOCK CHECK
      const roomDoc = await Room.findOne({ roomId }).select("blockedUsers").lean();
      if (roomDoc?.blockedUsers?.some(id => id.toString() === userId.toString())) {
        return socket.emit("error", { message: "You are blocked from this room" });
      }

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

      const rIdStr = roomId.toString();
      if (!roomMessages.has(rIdStr)) {
        roomMessages.set(rIdStr, []);
      }

      const messages = roomMessages.get(rIdStr);

      messages.push(message);

      // prevent memory overflow
      if (messages.length > 100) {
        messages.shift();
      }

      io.to(`room:${rIdStr}`).emit("message:receive", message);
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
        displayId: socket.data.displayId,
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
        displayId: socket.data.displayId,
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
       SOUND CONTROLS (DEAFEN)
    ========================= */
    const handleSoundChange = async (isMuted) => {
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      const userIdStr = userId.toString();
      deafenStates.set(userIdStr, isMuted);

      // Emit specific update to the room for quick status change
      io.to(`room:${roomId}`).emit("sound:update", {
        userId: userIdStr,
        displayId: socket.data.displayId,
        deafened: isMuted,
        soundMuted: isMuted,
      });

      // Broadcast full room users list to keep state in sync
      await broadcastRoomUsers(roomId);
    };

    socket.on("sound:mute", () => handleSoundChange(true));
    socket.on("sound:unmute", () => handleSoundChange(false));
    socket.on("sound:off", () => handleSoundChange(true));
    socket.on("sound:on", () => handleSoundChange(false));
    socket.on("user:deafen", () => handleSoundChange(true));
    socket.on("user:undeafen", () => handleSoundChange(false));
    socket.on("deafen:mute", () => handleSoundChange(true));
    socket.on("deafen:unmute", () => handleSoundChange(false));
    socket.on("sound:state", (payload) => {
      let isMuted = true;
      if (payload !== null && typeof payload === "object") {
        isMuted = payload.muted !== undefined ? payload.muted : (payload.deafened !== undefined ? payload.deafened : true);
      } else if (typeof payload === "boolean") {
        isMuted = payload;
      }
      handleSoundChange(isMuted);
    });
    socket.on("sound:toggle", () => {
      const { userId } = socket.data;
      if (!userId) return;
      const current = deafenStates.get(userId.toString()) || false;
      handleSoundChange(!current);
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
   VOICE & CALL WEBRTC SIGNALING
========================= */

    // call:offer (Frontend)
    socket.on("call:offer", ({ to, offer }) => {
      if (!to || !offer) return;

      const targetSocketIds = getUserSocketIds(to);
      if (!targetSocketIds.length) {
        console.warn("call:offer target offline:", to);
        return socket.emit("call:error", { message: "Target offline" });
      }

      targetSocketIds.forEach((ts) => {
        const payload = {
          from: socket.data.userId,
          fromUserId: socket.data.userId,
          offer,
        };
        io.to(ts).emit("call:offer", payload);
        io.to(ts).emit("voice:offer", payload);
      });
    });

    // voice:offer (Legacy / mobile fallback)
    socket.on("voice:offer", ({ targetUserId, offer }) => {
      if (!targetUserId || !offer) return;

      const targetSocketIds = getUserSocketIds(targetUserId);
      if (!targetSocketIds.length) {
        console.warn("voice:offer target offline:", targetUserId);
        return socket.emit("voice:error", { message: "Target offline" });
      }

      targetSocketIds.forEach((ts) => {
        const payload = {
          from: socket.data.userId,
          fromUserId: socket.data.userId,
          offer,
        };
        io.to(ts).emit("call:offer", payload);
        io.to(ts).emit("voice:offer", payload);
      });
    });

    // call:answer (Frontend)
    socket.on("call:answer", ({ to, answer }) => {
      if (!to || !answer) return;

      const targetSocketIds = getUserSocketIds(to);
      if (!targetSocketIds.length) {
        console.warn("call:answer target offline:", to);
        return socket.emit("call:error", { message: "Target offline" });
      }

      targetSocketIds.forEach((ts) => {
        const payload = {
          from: socket.data.userId,
          fromUserId: socket.data.userId,
          answer,
        };
        io.to(ts).emit("call:answer", payload);
        io.to(ts).emit("voice:answer", payload);
      });
    });

    // voice:answer (Legacy / mobile fallback)
    socket.on("voice:answer", ({ targetUserId, answer }) => {
      if (!targetUserId || !answer) return;

      const targetSocketIds = getUserSocketIds(targetUserId);
      if (!targetSocketIds.length) {
        console.warn("voice:answer target offline:", targetUserId);
        return socket.emit("voice:error", { message: "Target offline" });
      }

      targetSocketIds.forEach((ts) => {
        const payload = {
          from: socket.data.userId,
          fromUserId: socket.data.userId,
          answer,
        };
        io.to(ts).emit("call:answer", payload);
        io.to(ts).emit("voice:answer", payload);
      });
    });

    // call:ice (Frontend)
    socket.on("call:ice", ({ to, candidate }) => {
      if (!to || !candidate) return;

      const targetSocketIds = getUserSocketIds(to);
      if (!targetSocketIds.length) {
        return;
      }

      targetSocketIds.forEach((ts) => {
        const payload = {
          from: socket.data.userId,
          fromUserId: socket.data.userId,
          candidate,
        };
        io.to(ts).emit("call:ice", payload);
        io.to(ts).emit("voice:ice", payload);
      });
    });

    // voice:ice (Legacy / mobile fallback)
    socket.on("voice:ice", ({ targetUserId, candidate }) => {
      if (!targetUserId || !candidate) return;

      const targetSocketIds = getUserSocketIds(targetUserId);
      if (!targetSocketIds.length) {
        // don't spam logs for frequent ICE candidates
        return;
      }

      targetSocketIds.forEach((ts) => {
        const payload = {
          from: socket.data.userId,
          fromUserId: socket.data.userId,
          candidate,
        };
        io.to(ts).emit("call:ice", payload);
        io.to(ts).emit("voice:ice", payload);
      });
    });

    // ===============================
    // 🎉 ROOM INVITE
    // ===============================
    socket.on("room:invite", async ({ roomId, invitedUsers }) => {
      try {
        const inviterId = socket.data.userId;

        if (!inviterId || !roomId) return;

        const room = await Room.findOne({ roomId });

        if (!room) {
          return socket.emit("invite:error", {
            message: "Room not found",
          });
        }

        const inviter = await User.findById(inviterId);

        const invite = await RoomInvite.create({
          roomId,
          roomTitle: room.title || "Live Room",
          roomImage: room.backgroundImage || "",
          hostId: room.host,
          hostName: inviter.username,
          hostAvatar: inviter.profile?.avatar,
          invitedBy: inviterId,
          invitedUsers,
          type: "friend",
        });

        // SEND TO USERS
        invitedUsers.forEach((userId) => {
          io.to(userId.toString()).emit("room:invite:received", {
            inviteId: invite._id,
            roomId,
            roomTitle: invite.roomTitle,
            roomImage: invite.roomImage,
            hostName: invite.hostName,
            hostAvatar: invite.hostAvatar,
          });
        });

        socket.emit("room:invite:success", {
          success: true,
        });
      } catch (err) {
        console.error("❌ room invite error:", err);
      }
    });
    /* =========================
       CHAT
    ========================= */
    socket.on("message:send", async ({ roomId, text }) => {
      const { userId, username, avatar } = socket.data;

      if (!roomId || !text || !userId) return;

      // ✅ CHECK IF CHAT IS ENABLED
      const room = await Room.findOne({ roomId }).select("isChatEnabled host admins blockedUsers");
      if (!room) return;

      if (!room.isChatEnabled) {
        const isHost = room.host?.toString() === userId.toString();
        const isAdmin = room.admins?.some((id) => id.toString() === userId.toString());
        if (!isHost && !isAdmin) {
          return socket.emit("error", { message: "Chat is currently disabled by host" });
        }
      }

      // ✅ BLOCK CHECK
      if (room.blockedUsers?.some(id => id.toString() === userId.toString())) {
        return socket.emit("error", { message: "You are blocked from this room" });
      }

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

      const rIdStr = roomId.toString();
      if (!roomMessages.has(rIdStr)) {
        roomMessages.set(rIdStr, []);
      }

      const messages = roomMessages.get(rIdStr);
      messages.push(message);

      if (messages.length > 100) {
        messages.shift();
      }

      io.to(`room:${rIdStr}`).emit("message:receive", message);
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

      const rIdStr = roomId.toString();
      let messages = roomMessages.get(rIdStr) || [];
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

      roomMessages.set(rIdStr, messages);

      // =========================
      // 📡 EMIT UPDATE
      // =========================
      io.to(`room:${rIdStr}`).emit("message:edited", {
        messageId,
        newText,
      });

      console.log("✏️ Message edited:", messageId);
    });

    socket.on("message:delete", async ({ roomId, messageId, type }) => {
      const userId = socket.data.userId;

      const rIdStr = roomId.toString();
      let messages = roomMessages.get(rIdStr) || [];
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

        roomMessages.set(rIdStr, messages);

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

        roomMessages.set(rIdStr, messages);

        io.to(`room:${rIdStr}`).emit("message:deleted:everyone", {
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
        .map((s) => ({
          userId: s.data.userId || s.data.user?.id,
          id: s.data.userId || s.data.user?.id,
          displayId: s.data.displayId,
          username: s.data.username || s.data.user?.username,
          avatar: s.data.avatar || s.data.user?.avatar,
          level: s.data.user?.level || s.data.profile?.level || 1,
          country: s.data.user?.country || s.data.profile?.country || "Unknown",
          gender: s.data.user?.gender || s.data.profile?.gender || "Other",
          age: s.data.user?.age || s.data.profile?.age || 18,
          frame: s.data.user?.frame || s.data.profile?.frame || null,
          bubble: s.data.user?.bubble || s.data.profile?.bubble || null,
          mic: micStates.get(s.data.userId?.toString()) || {
            muted: false,
            speaking: false,
          },
          deafened: deafenStates.get(s.data.userId?.toString()) || false,
          soundMuted: deafenStates.get(s.data.userId?.toString()) || false,
        }))
        .filter(u => u.userId);

      socket.emit("room:usersStatus", {
        allUsers: usersStatus,
        onMicUsers: usersStatus.filter((u) => !u.mic.muted),
        speakingUsers: usersStatus.filter((u) => u.mic.speaking),
      });
    });

    // GET USER PROFILE FOR ROOM POPUP
    socket.on("room:user:profile", async ({ roomId, targetUserId }) => {
      try {
        if (!targetUserId) return;
        const dbUser = await User.findById(targetUserId)
          .select("username displayId profile.avatar profile.frame profile.bubble country gender age level.personal.level")
          .lean();

        if (!dbUser) return;

        const isInRoom = roomUsers.has(roomId) && roomUsers.get(roomId).has(targetUserId.toString());

        // ✅ CHECK BLOCK STATUS (INSIDE ROOM & OUTSIDE/PERSONAL)
        const roomDoc = await Room.findOne({ roomId }).select("blockedUsers").lean();
        const isBlockedInRoom = roomDoc?.blockedUsers?.some(id => id.toString() === targetUserId.toString()) || false;

        const personalBlock = await Block.findOne({ blocker: socket.data.userId, blocked: targetUserId }).lean();
        const isBlockedByMe = !!personalBlock;

        socket.emit("room:user:profile:response", {
          isBlockedInRoom,
          isBlockedByMe,
          userId: dbUser._id,
          displayId: dbUser.displayId,
          username: dbUser.username,
          avatar: dbUser.profile?.avatar || null,
          frame: dbUser.profile?.frame?.icon || null,
          bubble: dbUser.profile?.bubble || null,
          level: dbUser.level?.personal?.level || 1,
          gender: dbUser.gender || "Other",
          age: dbUser.age || 18,
          country: dbUser.country || "Unknown",
          isInRoom
        });
      } catch (error) {
        console.error("❌ room:user:profile error:", error);
      }
    });

    // GET ROOM MEMBERS FOR MEMBER TAB
    socket.on("room:members", async ({ roomId }) => {
      try {
        if (!roomId) return socket.emit("room:members:response", { success: false, message: "Missing roomId" });

        const roomDoc = await Room.findOne({ roomId }).lean();
        if (!roomDoc) {
          return socket.emit("room:members:response", { success: true, members: [] });
        }

        const participantIds = (roomDoc.participants || []).map((p) => p.user.toString());

        const users = await User.find({ _id: { $in: participantIds } })
          .select("_id username displayId profile.avatar profile.frame profile.bubble country gender age level")
          .lean();

        const userMap = new Map(users.map((u) => [u._id.toString(), u]));

        const members = (roomDoc.participants || []).map((p) => {
          const uid = p.user.toString();
          const u = userMap.get(uid) || {};
          return {
            userId: uid,
            username: u.username || null,
            displayId: u.displayId || null,
            avatar: u.profile?.avatar || p.avatar || null,
            frame: u.profile?.frame?.icon || null,
            bubble: u.profile?.bubble || null,
            role: p.role || (roomDoc.host?.toString() === uid ? "host" : "listener"),
            joinedAt: p.joinedAt || null,
          };
        });

        socket.emit("room:members:response", { success: true, members });
      } catch (err) {
        console.error("❌ room:members error:", err);
        socket.emit("room:members:response", { success: false, message: "Server error" });
      }
    });

    // LOCK SEAT (HOST ONLY)
    socket.on("room:seat:lock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHost(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host can lock seats" });

      const room = await getRoomSafe(roomId);
      if (!room || seatNumber < 1 || seatNumber > room.seatCount) {
        return socket.emit("error", { message: "Invalid seat number" });
      }

      await Room.updateOne(
        { roomId },
        { $addToSet: { lockedSeats: seatNumber } },
      );

      io.to(`room:${roomId}`).emit("room:seat:locked", { seatNumber });
    });

    // UNLOCK SEAT (HOST ONLY)
    socket.on("room:seat:unlock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHost(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host can unlock seats" });

      const room = await getRoomSafe(roomId);
      if (!room || seatNumber < 1 || seatNumber > room.seatCount) {
        return socket.emit("error", { message: "Invalid seat number" });
      }

      await Room.updateOne(
        { roomId },
        { $pull: { lockedSeats: seatNumber } },
      );

      io.to(`room:${roomId}`).emit("room:seat:unlocked", { seatNumber });
    });

    // MIC OFF (Force mute one user - HOST/ADMIN ONLY)
    socket.on("room:mic:forceOff", async (payload) => {
      const roomId = payload.roomId;
      const targetUserId = payload.targetUserId || payload.userId;
      const userId = socket.data.userId;
      if (!userId || !roomId || !targetUserId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can force mute" });

      micStates.set(targetUserId, { muted: true, speaking: false });

      io.to(`room:${roomId}`).emit("mic:update", {
        userId: targetUserId,
        displayId: null, // We don't have it here easily, but the ID is enough for the UI to find the user
        muted: true,
        speaking: false,
      });

      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit("mic:forceMuted");
      }
    });

    // MUTE EVERYONE (HOST ONLY)
    socket.on("room:mic:muteAll", async ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHost(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host can mute all" });

      const sockets = await io.in(`room:${roomId}`).fetchSockets();

      sockets.forEach((s) => {
        const uid = s.data.userId;
        if (!uid) return;
        micStates.set(uid, { muted: true, speaking: false });
      });

      io.to(`room:${roomId}`).emit("room:mic:mutedAll");
    });

    // LOCK ALL SEATS (HOST ONLY)
    socket.on("room:seats:lockAll", async ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHost(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host can lock all seats" });

      const room = await getRoomSafe(roomId);
      if (!room) return socket.emit("error", { message: "Room not found" });

      const allSeats = Array.from({ length: room.seatCount }, (_, i) => i + 1);
      room.lockedSeats = allSeats;
      await room.save();

      io.to(`room:${roomId}`).emit("room:seats:lockedAll", {
        lockedSeats: allSeats,
      });
    });

    // GIVE ADMIN (ONLY HOST CAN DO THIS)
    socket.on("room:giveAdmin", async (payload) => {
      try {
        const roomId = payload.roomId;
        const targetUserId = payload.targetUserId || payload.userId;
        const userId = socket.data.userId;
        if (!userId || !roomId || !targetUserId) return;

        const allowed = await isHost(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host can assign admin" });

        // Fetch room to validate current admins and participants
        const room = await Room.findOne({ roomId }).select("admins host participants").lean();
        if (!room) return socket.emit("error", { message: "Room not found" });

        const uid = targetUserId.toString();

        // Prevent promoting the host
        if (room.host && room.host.toString() === uid) {
          return socket.emit("error", { message: "Cannot promote host to admin" });
        }

        const currentAdmins = (room.admins || []).map((a) => a.toString());

        // Already an admin
        if (currentAdmins.includes(uid)) {
          return socket.emit("error", { message: "User is already an admin" });
        }

        // Limit admins to max 3
        if (currentAdmins.length >= 3) {
          return socket.emit("error", { message: "Maximum 3 admins allowed" });
        }

        // Ensure target is a participant (optional but recommended)
        const isParticipant = (room.participants || []).some((p) => p.user && p.user.toString() === uid);
        if (!isParticipant) {
          return socket.emit("error", { message: "User is not a participant of this room" });
        }

        await Room.updateOne(
          { roomId },
          {
            $addToSet: { admins: new mongoose.Types.ObjectId(targetUserId) },
            $set: { "participants.$[elem].role": "admin" },
          },
          { arrayFilters: [{ "elem.user": new mongoose.Types.ObjectId(targetUserId) }] },
        );

        io.to(`room:${roomId}`).emit("room:adminAdded", {
          userId: targetUserId,
        });

        await broadcastRoomUsers(roomId);

        socket.emit("room:giveAdmin:success", { userId: targetUserId });
        console.log(`👑 User ${targetUserId} promoted to Admin in ${roomId}`);
      } catch (err) {
        console.error("❌ room:giveAdmin error:", err);
      }
    });

    // REMOVE ADMIN (ONLY HOST CAN DO THIS)
    socket.on("room:removeAdmin", async (payload) => {
      try {
        const roomId = payload.roomId;
        const targetUserId = payload.targetUserId || payload.userId;
        const userId = socket.data.userId;
        if (!userId || !roomId || !targetUserId) return;

        const allowed = await isHost(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host can remove admin" });

        const room = await Room.findOne({ roomId }).select("admins host").lean();
        if (!room) return socket.emit("error", { message: "Room not found" });

        const uid = targetUserId.toString();

        // Prevent removing host
        if (room.host && room.host.toString() === uid) {
          return socket.emit("error", { message: "Cannot remove host from admin" });
        }

        const currentAdmins = (room.admins || []).map((a) => a.toString());
        if (!currentAdmins.includes(uid)) {
          return socket.emit("error", { message: "User is not an admin" });
        }

        await Room.updateOne(
          { roomId },
          {
            $pull: { admins: new mongoose.Types.ObjectId(targetUserId) },
            $set: { "participants.$[elem].role": "listener" },
          },
          { arrayFilters: [{ "elem.user": new mongoose.Types.ObjectId(targetUserId) }] },
        );

        io.to(`room:${roomId}`).emit("room:adminRemoved", { userId: targetUserId });

        await broadcastRoomUsers(roomId);

        socket.emit("room:removeAdmin:success", { userId: targetUserId });

        console.log(`🚫 User ${targetUserId} removed from Admin in ${roomId}`);
      } catch (err) {
        console.error("❌ room:removeAdmin error:", err);
      }
    });

    // REMOVE FROM SEAT (FORCE)
    socket.on("room:seat:forceLeave", async (payload) => {
      try {
        const roomId = payload.roomId;
        const targetUserId = payload.targetUserId || payload.userId;
        const userId = socket.data.userId;
        if (!userId || !roomId || !targetUserId) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can remove from seat" });

        console.log("🪑 Force removing from seat:", targetUserId);

        let roomSeats = seats.get(roomId) || [];
        roomSeats = roomSeats
          .map((id) => id.toString())
          .filter((id) => id !== targetUserId.toString());

        seats.set(roomId, roomSeats);
        micStates.set(targetUserId.toString(), { muted: true, speaking: false });

        const targetSocketIds = getUserSocketIds(targetUserId);
        if (targetSocketIds.length) {
          targetSocketIds.forEach((ts) => {
            const targetSocket = io.sockets.sockets.get(ts);
            if (targetSocket) {
              targetSocket.data.isWatcher = true;
            }
            io.to(ts).emit("room:seat:forceRemoved", { roomId });
          });
        }

        // Broadcast full state update
        await broadcastRoomUsers(roomId);
      } catch (err) {
        console.error("❌ room:seat:forceLeave error:", err);
      }
    });

    // KICK OUT FROM ROOM
    socket.on("room:kickOut", async (payload) => {
      try {
        const roomId = payload.roomId;
        const targetUserId = payload.targetUserId || payload.userId;
        const userId = socket.data.userId;
        if (!userId || !roomId || !targetUserId) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can kick out" });

        await Room.updateOne({ roomId }, {
          $push: { kickedUsers: { userId: targetUserId, kickedAt: new Date() } },
          $pull: { participants: { user: new mongoose.Types.ObjectId(targetUserId) } },
          $inc: { currentUsers: -1 }
        });

        // ✅ REMOVE FROM SEATS
        let roomSeats = seats.get(roomId) || [];
        roomSeats = roomSeats
          .map((id) => id.toString())
          .filter((id) => id !== targetUserId.toString());
        seats.set(roomId, roomSeats);

        const targetSocketIds = getUserSocketIds(targetUserId);
        if (targetSocketIds.length) {
          targetSocketIds.forEach((ts) => {
            io.to(ts).emit("room:kicked", { roomId, message: "You have been kicked from the room" });
            const targetSocket = io.sockets.sockets.get(ts);
            if (targetSocket) {
              targetSocket.data.hasLeftRoom = true;
              targetSocket.leave(`room:${roomId}`);
              targetSocket.data.roomId = null;
            }
          });
        }

        // Broadcast updated users list
        await broadcastRoomUsers(roomId);

        console.log(`👢 User ${targetUserId} kicked from ${roomId}`);
      } catch (err) {
        console.error("❌ room:kickOut error:", err);
      }
    });

    // BLOCK USER FROM ROOM
    socket.on("room:blockUser", async (payload) => {
      try {
        const roomId = payload.roomId;
        const targetUserId = payload.targetUserId || payload.userId;
        const userId = socket.data.userId;
        if (!userId || !roomId || !targetUserId) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can block user" });

        await Room.updateOne({ roomId }, {
          $addToSet: { blockedUsers: new mongoose.Types.ObjectId(targetUserId) },
          $pull: { participants: { user: new mongoose.Types.ObjectId(targetUserId) } },
          $inc: { currentUsers: -1 }
        });

        // ✅ CLEAN SERVER MEMORY
        if (roomUsers.has(roomId)) roomUsers.get(roomId).delete(targetUserId.toString());
        if (typingUsers.has(roomId)) typingUsers.get(roomId).delete(targetUserId.toString());
        backgroundUsers.delete(targetUserId.toString());

        // ✅ REMOVE FROM SEATS
        let roomSeats = seats.get(roomId) || [];
        roomSeats = roomSeats
          .map((id) => id.toString())
          .filter((id) => id !== targetUserId.toString());
        seats.set(roomId, roomSeats);

        const targetSocketIds = getUserSocketIds(targetUserId);
        if (targetSocketIds.length) {
          targetSocketIds.forEach((ts) => {
            io.to(ts).emit("room:blocked", { roomId, message: "You have been blocked from this room" });
            const targetSocket = io.sockets.sockets.get(ts);
            if (targetSocket) {
              targetSocket.data.hasLeftRoom = true;
              targetSocket.leave(`room:${roomId}`);
              targetSocket.data.roomId = null;
            }
          });
        }

        // Broadcast updated users list
        await broadcastRoomUsers(roomId);

        console.log(`🚫 User ${targetUserId} blocked from ${roomId}`);
      } catch (err) {
        console.error("❌ room:blockUser error:", err);
      }
    });

    // ===============================
    // 🚫 ROOM BLOCK MANAGEMENT
    // ===============================

    // GET BLOCKED USERS LIST IN ROOM
    socket.on("room:blockedList", async ({ roomId }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can see block list" });

        const room = await Room.findOne({ roomId })
          .populate("blockedUsers", "username displayId profile.avatar")
          .lean();

        if (!room) return;

        socket.emit("room:blockedList:response", {
          roomId,
          blockedUsers: (room.blockedUsers || []).map(u => ({
            userId: u._id,
            username: u.username,
            displayId: u.displayId,
            avatar: u.profile?.avatar || null
          }))
        });
      } catch (err) {
        console.error("❌ room:blockedList error:", err);
      }
    });

    // UNBLOCK USER FROM ROOM
    socket.on("room:unblockUser", async ({ roomId, targetUserId }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId || !targetUserId) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can unblock" });

        await Room.updateOne({ roomId }, {
          $pull: { blockedUsers: new mongoose.Types.ObjectId(targetUserId) }
        });

        socket.emit("room:unblocked", {
          roomId,
          targetUserId,
          message: "User unblocked successfully"
        });

        console.log(`✅ User ${targetUserId} unblocked in ${roomId}`);
      } catch (err) {
        console.error("❌ room:unblockUser error:", err);
      }
    });

    // ===============================
    // 🚫 PERSONAL BLOCK MANAGEMENT
    // ===============================

    // GET PERSONAL BLOCK LIST
    socket.on("user:blockList", async () => {
      try {
        const userId = socket.data.userId;
        if (!userId) return;

        const blockedEntries = await Block.find({ blocker: userId })
          .populate("blocked", "username displayId profile.avatar")
          .lean();

        socket.emit("user:blockList:response", {
          blockedUsers: blockedEntries.filter(e => e.blocked).map(e => ({
            userId: e.blocked._id,
            username: e.blocked.username,
            displayId: e.blocked.displayId,
            avatar: e.blocked.profile?.avatar || null,
            blockedAt: e.createdAt
          }))
        });
      } catch (err) {
        console.error("❌ user:blockList error:", err);
      }
    });

    // UNBLOCK USER GLOBALLY
    socket.on("user:unblock", async ({ targetUserId }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !targetUserId) return;

        await Block.findOneAndDelete({
          blocker: userId,
          blocked: targetUserId
        });

        socket.emit("user:unblocked", {
          targetUserId,
          message: "User unblocked successfully"
        });
      } catch (err) {
        console.error("❌ user:unblock error:", err);
      }
    });

    // CLEAN CHAT (ONLY HOST/ADMIN)
    socket.on("room:chat:clean", async ({ roomId }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId) return;

        const rId = roomId.toString();

        const allowed = await isHostOrAdmin(rId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can clean chat" });

        // Fetch user's current username and profile details for the system message
        const dbUser = await User.findById(userId)
          .select("username displayId profile.avatar level")
          .lean();
        const username = dbUser?.username || socket.data.user?.username || socket.data.username || "Host/Admin";

        // 1. Clear from DB
        await Message.deleteMany({ room: rId });

        // 2. Create the system notification message in DB
        const systemText = `${username} cleared the chat message`;
        const newMessage = await Message.create({
          content: systemText,
          sender: userId,
          room: rId,
          messageType: "system",
        });

        // 3. Construct system message payload matching front-end expectation
        const systemMessagePayload = {
          id: `system-${userId}-${Date.now()}`,
          dbId: newMessage._id,
          roomId: rId,
          userId,
          displayId: dbUser?.displayId || socket.data.displayId || null,
          username,
          avatar: dbUser?.profile?.avatar || socket.data.avatar || null,
          text: systemText,
          messageType: "system",
          bubble: null,
          frame: null,
          level: dbUser?.level?.personal?.level || 1,
          timestamp: new Date().toISOString(),
          deletedForEveryone: false,
          deletedFor: [],
        };

        // 4. Clear from In-Memory Map and seed with the system message
        roomMessages.set(rId, [systemMessagePayload]);

        // 5. Broadcast specific events to everyone in the room
        const roomName = `room:${rId}`;
        io.to(roomName).emit("room:chat:cleaned", {
          roomId: rId,
          clearedBy: username,
          message: systemMessagePayload
        });
        io.to(roomName).emit("room:messages", [systemMessagePayload]);
        io.to(roomName).emit("message:receive", systemMessagePayload);

        console.log(`🧹 Chat cleaned in room: ${rId} by ${username} (${userId})`);
      } catch (err) {
        console.error("❌ room:chat:clean error:", err);
      }
    });

    // TOGGLE PUBLIC CHAT (ONLY HOST/ADMIN)
    socket.on("room:chat:toggle", async ({ roomId, isEnabled }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can toggle chat" });

        await Room.updateOne({ roomId }, { isChatEnabled: isEnabled });

        io.to(`room:${roomId}`).emit("room:chat:toggled", {
          roomId,
          isEnabled,
          message: isEnabled ? "Chat is now public" : "Chat is now restricted to Host/Admins"
        });

        console.log(`📢 Room ${roomId} chat enabled: ${isEnabled}`);
      } catch (err) {
        console.error("❌ room:chat:toggle error:", err);
      }
    });

    // ===============================
    // 👑 ADMIN COMMANDS (Help Rooms & Roles)
    // ===============================

    // MARK AS HELP ROOM (ADMIN ONLY)
    socket.on("room:setHelpRoom", async ({ roomId, isHelp, helpEmails }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId) return;

        const user = await User.findById(userId);
        if (!user || user.role !== "admin") {
          return socket.emit("error", { message: "Only Global Admins can do this" });
        }

        const room = await Room.findOne({ roomId });
        if (!room) return socket.emit("error", { message: "Room not found" });

        room.isHelpRoom = isHelp === true;
        // When admin marks as help, also mark as admin-created (persistent)
        room.createdByAdmin = isHelp === true;
        if (helpEmails !== undefined) {
          if (Array.isArray(helpEmails)) {
            // Keep up to 3 support/alternative emails
            room.helpEmails = helpEmails.slice(0, 3).map(email => String(email).trim());
          } else {
            room.helpEmails = [];
          }
        }
        await room.save();

        console.log(`🔒 Room ${roomId} set as Help Room: ${room.isHelpRoom}, emails: ${room.helpEmails}`);

        socket.emit("room:helpStatus", {
          roomId,
          isHelpRoom: room.isHelpRoom,
          helpEmails: room.helpEmails,
          message: room.isHelpRoom ? "Room is now a permanent Help Room" : "Room is now a regular room",
        });

        // Broadcast update to refresh list for everyone
        io.emit("room:listUpdate");
      } catch (err) {
        console.error("❌ setHelpRoom error:", err);

      }
    });

    // SET USER ROLE (ADMIN ONLY)
    socket.on("user:setRole", async ({ targetUserId, role }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !targetUserId || !role) return;

        const adminUser = await User.findById(userId);
        if (!adminUser || adminUser.role !== "admin") {
          return socket.emit("error", { message: "Unauthorized" });
        }

        const allowedRoles = ["user", "host", "admin"];
        if (!allowedRoles.includes(role)) {
          return socket.emit("error", { message: "Invalid role" });
        }

        await User.findByIdAndUpdate(targetUserId, { role });

        socket.emit("user:roleUpdated", {
          targetUserId,
          role,
          message: `User role updated to ${role}`,
        });
      } catch (err) {
        console.error("❌ setRole error:", err);
      }
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", async () => {
      const { roomId, userId, user } = socket.data;
      if (socket.data.hasLeftRoom) return;
      if (roomId && userId) {
        const roomSeats = seats.get(roomId) || [];
        seats.set(
          roomId,
          roomSeats.filter((id) => id !== userId),
        );
      }

      const room = await Room.findOne({ roomId });

      if (room) {
        room.currentUsers = Math.max(0, room.currentUsers - 1);

        room.lastActivityAt = new Date();

        // HOST DISCONNECTED
        if (room.host && room.host.toString() === userId.toString()) {
          room.hostOnline = false;
          room.hostLeftAt = new Date();

          // ✅ HELP ROOM EXCEPTION: Never mark as host_left or inactive
          if (!room.isHelpRoom) {
            room.status = "host_left";
            room.isActive = false;
          }

          io.to(`room:${roomId}`).emit("room:hostLeft", {
            roomId,
          });
        }

        room.participants = room.participants.filter(
          (p) => p.user.toString() !== userId.toString(),
        );
        await VideoRoom.updateOne(
          { roomId },
          {
            $pull: {
              participants: {
                userId,
              },
            },
          },
        );
        // EMPTY ROOM
        if (room.currentUsers <= 0) {
          // Keep help rooms or admin-created rooms persistent
          if (room.isHelpRoom || room.createdByAdmin) {
            // Keep help room active but clear participants list
            room.status = "active";
            room.isActive = true;
            room.participants = [];
            await room.save();

            await VideoRoom.updateOne(
              { roomId },
              { $set: { participants: [], "video.isPlaying": false } }
            );

            seats.delete(roomId);
            roomUsers.delete(roomId);
            typingUsers.delete(roomId);

            console.log("ℹ️ Help/Admin Room kept active on disconnect:", roomId);
          } else {
            room.status = "ended";

            await room.save();

            await Room.deleteOne({ roomId });

            await VideoRoom.deleteOne({ roomId });

            await MusicState.deleteOne({ roomId });

            roomManager.stopMusic(roomId);
            seats.delete(roomId);

            roomUsers.delete(roomId);

            roomMessages.delete(roomId);

            typingUsers.delete(roomId);

            console.log("🗑 Auto cleaned room:", roomId);

            return;
          }
        }

        await room.save();
      }
      try {
        // 🔥🔥🔥 MOST IMPORTANT FIX
        if (socket.data.isBackground) {
          console.log("🟡 Background user disconnect ignored:", userId);
          return;
        }

        if (userId) {
          // ✅ Remove this socket from user's socket set
          removeUserSocket(userId, socket.id);
          const remaining = getUserSocketIds(userId);
          if (remaining.length === 0) {
            onlineUsers.delete(userId);
            micStates.delete(userId);
            deafenStates.delete(userId.toString());
          } else {
            // keep onlineUsers mapped to one active socket
            onlineUsers.set(userId, remaining[0]);
          }

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

        if (roomId) {
          // ✅ Update DB count
          await Room.updateOne({ roomId }, { $inc: { currentUsers: -1 } });

          socket.to(`room:${roomId}`).emit("room:userLeft", {
            userId: socket.data.userId,
            displayId: socket.data.displayId,
          });

          // ✅ Broadcast updated Watcher Count after someone leaves
          await broadcastWatcherCount(roomId, io);
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
