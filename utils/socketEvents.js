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
const Conversation = require("../models/conversation");
const PrivateMessage = require("../models/privateMessage");
const Notification = require("../models/notification");
async function getRoomSafe(roomId) {
  return await Room.findOne({ roomId });
}
// pkId -> timeoutId
const pkTimers = new Map();
const backgroundUsers = new Map(); // userId -> true
const roomCleanupTimeouts = new Map(); // roomId -> Timeout
const hostLeftTimeouts = new Map();     // roomId -> Timeout
const videoRoomCleanupTimeouts = new Map(); // roomId -> Timeout for VideoRoom cleanup
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
async function broadcastWatcherCount(roomId, io, excludeUserId = null) {
  if (!roomId) return;
  const roomName = `room:${roomId}`;
  const sockets = await io.in(roomName).fetchSockets();
  const rawSeats = seats.get(roomId) || [];
  const seatSnapshot = new Set(rawSeats.map((id) => (id ? id.toString() : null)).filter(Boolean));

  const watcherCount = sockets.filter(s => {
    const userIdStr = s.data.userId?.toString();
    if (excludeUserId && userIdStr === excludeUserId.toString()) return false;
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
  try {
    if (!pk || pk.rewardsDistributed) return;

    const WIN_REWARD = 100;
    const LOSE_REWARD = 20;
    const DRAW_REWARD = 50;

    const leftUserId = pk.leftUser?.userId?.toString();
    const rightUserId = pk.rightUser?.userId?.toString();

    if (!leftUserId || !rightUserId) {
      console.warn("⚠️ Cannot distribute rewards, user ID missing in PK battle:", pk._id);
      return;
    }

    if (pk.winner) {
      const winnerId = pk.winner.toString();
      const loserId = leftUserId === winnerId ? rightUserId : leftUserId;

      await levelController.addRoomExp(winnerId, WIN_REWARD, io);
      await levelController.addRoomExp(loserId, LOSE_REWARD, io);
    } else {
      // Draw
      await levelController.addRoomExp(leftUserId, DRAW_REWARD, io);
      await levelController.addRoomExp(rightUserId, DRAW_REWARD, io);
    }

    pk.rewardsDistributed = true;
    await pk.save();
  } catch (err) {
    console.error("❌ Error in distributePKRewards:", err);
  }
}

// ===============================
// 🏁 END PK (WINNER + CLEANUP)
// ===============================
async function endPKInternal(pkId, io) {
  try {
    const pk = await PKBattle.findById(pkId);
    if (!pk || pk.status !== "running") return;

    console.log(`🥊 Ending PK Battle: ${pkId}`);

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

    const supporterMap = new Map();
    if (Array.isArray(pk.contributions)) {
      pk.contributions.forEach((c) => {
        if (c.fromUser) {
          const key = c.fromUser.toString();
          supporterMap.set(key, (supporterMap.get(key) || 0) + c.value);
        }
      });
    }

    const sorted = Array.from(supporterMap.entries())
      .map(([userId, total]) => ({ userId, total }))
      .sort((a, b) => b.total - a.total);

    pk.topSupporters = sorted.slice(0, 10); // top 10
    pk.mvpSupporter = sorted.length > 0 ? sorted[0].userId : null;

    await pk.save();

    // ===============================
    // 📊 Update User PK Stats (W/L/D)
    // ===============================
    const leftId = pk.leftUser?.userId?.toString();
    const rightId = pk.rightUser?.userId?.toString();

    let leftUser = null;
    let rightUser = null;

    if (leftId && rightId) {
      leftUser = await User.findById(leftId);
      rightUser = await User.findById(rightId);

      if (leftUser && rightUser) {
        if (!leftUser.pkStats) {
          leftUser.pkStats = { wins: 0, losses: 0, draws: 0, totalSupportSent: 0, totalSupportReceived: 0 };
        }
        if (!rightUser.pkStats) {
          rightUser.pkStats = { wins: 0, losses: 0, draws: 0, totalSupportSent: 0, totalSupportReceived: 0 };
        }

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
      leftScore: pk.leftUser?.score || 0,
      rightScore: pk.rightUser?.score || 0,
      winner: pk.winner,
      winnerDisplayId: pk.winner
        ? (pk.winner.toString() === leftId ? leftUser?.displayId : rightUser?.displayId)
        : null,
    });
  } catch (err) {
    console.error("❌ Error ending PK battle:", err);
  }
}

// ===============================
// 🥊 CHECK AND END PK ON USER LEAVE
// ===============================
async function checkAndEndPKOnUserLeave(roomId, userId, io) {
  try {
    if (!roomId || !userId) return;
    const room = await Room.findOne({ roomId });
    if (!room || !room.activePK) return;

    const pk = await PKBattle.findById(room.activePK);
    if (!pk || pk.status !== "running") return;

    const leftUserId = pk.leftUser?.userId?.toString();
    const rightUserId = pk.rightUser?.userId?.toString();
    const leavingUserId = userId.toString();

    if (leavingUserId === leftUserId || leavingUserId === rightUserId) {
      console.log(`🥊 PK participant ${leavingUserId} left room/seat. Ending PK battle ${pk._id}.`);
      await endPKInternal(pk._id, io);
    }
  } catch (err) {
    console.error("❌ Error in checkAndEndPKOnUserLeave:", err);
  }
}


module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const deafenStates = new Map(); // userId -> boolean (sound status)
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room
  const forceMutedUsers = new Map(); // roomId -> Set of userIds force-muted by host/admin

  // ✅ HELPER: Broadcast Room Users (Full State)
  const broadcastRoomUsers = async (roomId, excludeUserIds = []) => {
    try {
      const roomName = `room:${roomId}`;
      const roomDoc = await Room.findOne({ roomId }).lean();
      if (!roomDoc) return [];

      const sockets = await io.in(roomName).fetchSockets();

      const excludeSet = new Set(
        (Array.isArray(excludeUserIds) ? excludeUserIds : [excludeUserIds])
          .filter(Boolean)
          .map((id) => id.toString())
      );

      const userIds = sockets
        .map((s) => s.data.userId?.toString())
        .filter((id) => id && !excludeSet.has(id));

      const users = await User.find({ _id: { $in: userIds } })
        .select("displayId username profile.avatar profile.frame profile.bubble country gender age level")
        .lean();

      const userMap = new Map(users.map((u) => [u._id.toString(), u]));
      const rawSeats = seats.get(roomId) || [];
      const roomSeatsList = rawSeats.map((id) => (id ? id.toString() : null));
      const seatSnapshot = new Set(roomSeatsList.filter(Boolean));

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
          if (!userIdStr || excludeSet.has(userIdStr)) return null;

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
            seatIndex: seatSnapshot.has(userIdStr) ? roomSeatsList.indexOf(userIdStr) : -1,
            isBackground: backgroundUsers.has(userIdStr),
            isAdmin: admins.has(userIdStr),
            isHost: userIdStr === hostId,
            role: userIdStr === hostId ? "host" : admins.has(userIdStr) ? "admin" : "listener",
            frame: dbUser?.profile?.frame?.icon || null,
            bubble: dbUser?.profile?.bubble || null,
            level: dbUser?.level?.personal?.level || 1,
            country: dbUser?.country || "Unknown",
            gender: dbUser?.gender || "Other",
            age: dbUser?.age || 18,
            mic: micStates.get(userIdStr) || {
              muted: true,
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

  // KICK NON HOST/ADMINS FROM SEATS
  const kickNonHostAdminsFromSeats = async (roomId, room) => {
    try {
      let roomSeats = seats.get(roomId) || [];
      const normalized = roomSeats.map((id) => (id ? id.toString() : null));

      const hostIdStr = room.host?.toString();
      const adminIds = (room.admins || []).map((id) => id.toString());

      // Find standard users on seats
      const usersToKick = normalized.filter((id) => id && id !== hostIdStr && !adminIds.includes(id));
      if (usersToKick.length === 0) return;

      // Build new seats array preserving positions (set non host/admins to null)
      const newRoomSeats = normalized.map((id) => {
        if (!id) return null;
        if (id === hostIdStr || adminIds.includes(id)) return id;
        return null;
      });
      seats.set(roomId, newRoomSeats);

      const sockets = await io.in(`room:${roomId}`).fetchSockets();
      sockets.forEach((s) => {
        const socketUserId = s.data.userId?.toString();
        if (socketUserId && usersToKick.includes(socketUserId)) {
          s.data.isWatcher = true;
          micStates.set(s.data.userId, { muted: true, speaking: false });

          const seatIndex = normalized.indexOf(socketUserId);
          s.emit("room:seat:removed", {
            userId: s.data.userId,
            displayId: s.data.displayId || s.data.user?.displayId || null,
            seatNumber: seatIndex >= 0 ? seatIndex + 1 : null,
          });
        }
      });

      usersToKick.forEach((kickedUserId) => {
        const userSocket = sockets.find((s) => s.data.userId?.toString() === kickedUserId);
        const displayId = userSocket ? (userSocket.data.displayId || userSocket.data.user?.displayId || null) : null;
        const seatIndex = normalized.indexOf(kickedUserId);

        io.to(`room:${roomId}`).emit("room:seat:removed", {
          userId: kickedUserId,
          displayId: displayId,
          seatNumber: seatIndex >= 0 ? seatIndex + 1 : null,
        });
      });

      await broadcastRoomUsers(roomId);
    } catch (err) {
      console.error("❌ kickNonHostAdminsFromSeats error:", err);
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
      User.findByIdAndUpdate(userId, { lastSeen: new Date() }).catch(e => console.error("Error updating lastSeen on connect:", e));
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
      micStates.set(userId, { muted: true, speaking: false });

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

      let safeUser = user || socket.data.user;
      if ((!safeUser || !safeUser.id) && socket.data.userId) {
        safeUser = {
          id: socket.data.userId,
          username: socket.data.username,
          avatar: socket.data.avatar,
        };
      }

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
      socket.data.hasLeftRoom = false;

      // ⭐ FETCH FULL USER (for metadata/displayId)
      const dbUser = await User.findById(userId)
        .select("displayId username profile.avatar profile.frame profile.bubble country gender age level")
        .lean();

      socket.data.displayId = dbUser?.displayId || socket.data.displayId || null;

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
        const roomDoc = await Room.findOne({ roomId }).select("+password");
        if (!roomDoc) {
          return socket.emit("room:error", { message: "Room not found" });
        }

        // Cancel any pending room cleanup or host-left grace period
        if (roomCleanupTimeouts.has(roomId)) {
          clearTimeout(roomCleanupTimeouts.get(roomId));
          roomCleanupTimeouts.delete(roomId);
          console.log(`✨ Room cleanup cancelled for room ${roomId}`);
        }
        // Cancel any pending VideoRoom cleanup
        if (videoRoomCleanupTimeouts.has(roomId)) {
          clearTimeout(videoRoomCleanupTimeouts.get(roomId));
          videoRoomCleanupTimeouts.delete(roomId);
          console.log(`✨ VideoRoom cleanup cancelled for room ${roomId}`);
        }
        if (roomDoc.host && roomDoc.host.toString() === userId.toString()) {
          roomDoc.hostOnline = true;
          if (hostLeftTimeouts.has(roomId)) {
            clearTimeout(hostLeftTimeouts.get(roomId));
            hostLeftTimeouts.delete(roomId);
            console.log(`✨ Host rejoined. Cancelled hostLeft grace period for room ${roomId}`);
          }
          if (roomDoc.status === "host_left") {
            roomDoc.status = "active";
            roomDoc.isActive = true;
          }
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

        const freshAvatar = dbUser?.profile?.avatar || socket.data.avatar || socket.data.user?.avatar;

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

          roomDoc.lastActivityAt = new Date();
          roomDoc.participants.push({
            user: userId,
            role: roomDoc.host.toString() === userId.toString() ? "host" : "listener",
            avatar: freshAvatar,
            joinedAt: new Date(),
          });
        } else {
          // Sync existing participant's avatar with their fresh profile avatar
          const pIdx = roomDoc.participants.findIndex(
            (p) => p.user.toString() === userId.toString(),
          );
          if (pIdx !== -1) {
            roomDoc.participants[pIdx].avatar = freshAvatar;
          }
        }
        roomDoc.currentUsers = roomDoc.participants.length;
        await roomDoc.save();

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

        /* ===== LOCKED SEATS & STATE ===== */
        // socket.emit("room:seats:lockedAll", {
        //   lockedSeats: roomDoc?.lockedSeats || [],
        // });
        // socket.emit("room:lockedState", {
        //   isLocked: roomDoc?.isLocked || false,
        // });

        /* ===== DESCRIPTION ===== */
        socket.emit("room:description", {
          roomId,
          description: roomDoc?.description || "",
          updatedBy: roomDoc?.descriptionUpdatedBy || "",
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

        // ✅ Emit latest room details to ensure syncing
        socket.emit("room:updated", {
          room: roomDoc,
        });
      } catch (err) {
        console.error("❌ room:watch error:", err);
      }
    });

    /* =========================
       ROOM JOIN
    ========================= */
    socket.on("room:join", async ({ roomId, user, password }) => {
      if (!roomId) return;

      let safeUser = user || socket.data.user;
      if ((!safeUser || !safeUser.id) && socket.data.userId) {
        safeUser = {
          id: socket.data.userId,
          username: socket.data.username,
          avatar: socket.data.avatar,
        };
      }

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

      socket.data.displayId = dbUser?.displayId || socket.data.displayId || null;

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
        const roomDoc = await Room.findOne({ roomId }).select("+password");
        // ❌ ROOM NOT FOUND
        if (!roomDoc) {
          socket.leave(roomName);
          return socket.emit("room:error", {
            message: "Room not found",
          });
        }

        // Cancel any pending room cleanup or host-left grace period
        if (roomCleanupTimeouts.has(roomId)) {
          clearTimeout(roomCleanupTimeouts.get(roomId));
          roomCleanupTimeouts.delete(roomId);
          console.log(`✨ Room cleanup cancelled for room ${roomId}`);
        }
        // Cancel any pending VideoRoom grace-period cleanup
        if (videoRoomCleanupTimeouts.has(roomId)) {
          clearTimeout(videoRoomCleanupTimeouts.get(roomId));
          videoRoomCleanupTimeouts.delete(roomId);
          console.log(`✨ VideoRoom cleanup cancelled for room ${roomId}`);
        }
        if (roomDoc.host && roomDoc.host.toString() === userId.toString()) {
          roomDoc.hostOnline = true;
          if (hostLeftTimeouts.has(roomId)) {
            clearTimeout(hostLeftTimeouts.get(roomId));
            hostLeftTimeouts.delete(roomId);
            console.log(`✨ Host rejoined. Cancelled hostLeft grace period for room ${roomId}`);
          }
          if (roomDoc.status === "host_left") {
            roomDoc.status = "active";
            roomDoc.isActive = true;
          }
        }

        // ❌ BLOCKED USER
        if (roomDoc.blockedUsers && roomDoc.blockedUsers.some(id => id.toString() === userId.toString())) {
          socket.leave(roomName);
          return socket.emit("room:error", {
            message: "You are blocked from this room",
          });
        }

        // ❌ KICKED USER
        if (roomDoc.kickedUsers && roomDoc.kickedUsers.some(k => k.userId && k.userId.toString() === userId.toString())) {
          socket.leave(roomName);
          return socket.emit("room:error", {
            message: "You have been kicked from this room",
          });
        }

        // ❌ ROOM ENDED
        if (roomDoc.status === "ended") {
          socket.leave(roomName);
          return socket.emit("room:error", {
            message: "Room ended",
          });
        }

        // ❌ HOST LEFT (room still usable — users can still join)
        // We no longer block entry when host_left. Room stays active.
        // if (roomDoc.status === "host_left") {
        //   return socket.emit("room:expired", { message: "Host left the room" });
        // }

        // ===============================
        // 📝 SEND DESCRIPTION (FIXED)
        // ===============================
        socket.emit("room:description", {
          roomId,
          description: roomDoc?.description || "",
          updatedBy: roomDoc?.descriptionUpdatedBy || "",
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
        const hostId = roomDoc.host?.toString();
        const creatorId = roomDoc.creator?.toString();
        const userIdString = userId.toString();

        // Verify block first
        if (hostId) {
          const isBlocked = await Block.findOne({
            blocker: new mongoose.Types.ObjectId(hostId),
            blocked: new mongoose.Types.ObjectId(userIdString),
          });
          if (isBlocked) {
            socket.leave(roomName);
            return socket.emit("room:error", {
              message: "You have been blocked, you can't enter the room",
              isBlocked: true,
            });
          }
        }

        // Verify password first if room is locked and user is not host/creator (prevent bypasses)
        if (roomDoc.isLocked && hostId !== userIdString && creatorId !== userIdString) {
          if (!password || password !== roomDoc.password) {
            socket.leave(roomName);
            return socket.emit("room:error", {
              message: "Incorrect or missing password for this room",
              isLocked: true,
            });
          }
        }

        const alreadyJoined = roomDoc.participants.some(
          (p) => p.user.toString() === userId.toString(),
        );

        const freshAvatar = dbUser?.profile?.avatar || dbUser?.avatar || socket.data.avatar || safeUser.avatar;

        if (!alreadyJoined) {
          roomDoc.lastActivityAt = new Date();

          let role = "listener";
          if (roomDoc.host.toString() === userId.toString()) {
            role = "host";
          } else if (roomDoc.admins && roomDoc.admins.some(id => id.toString() === userId.toString())) {
            role = "admin";
          }

          roomDoc.participants.push({
            user: userId,
            role: role,
            avatar: freshAvatar,
            joinedAt: new Date(),
          });
        } else {
          // Sync existing participant's avatar with their fresh profile avatar and check if their role is admin
          const pIdx = roomDoc.participants.findIndex(
            (p) => p.user.toString() === userId.toString(),
          );
          if (pIdx !== -1) {
            roomDoc.participants[pIdx].avatar = freshAvatar;
            let role = "listener";
            if (roomDoc.host.toString() === userId.toString()) {
              role = "host";
            } else if (roomDoc.admins && roomDoc.admins.some(id => id.toString() === userId.toString())) {
              role = "admin";
            }
            roomDoc.participants[pIdx].role = role;
          }
        }

        roomDoc.currentUsers = roomDoc.participants.length;
        await roomDoc.save();

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

        const joinedUser = socket.data.user || {};
        socket.to(roomName).emit("room:userJoined", {
          id: joinedUser.id || socket.data.userId,
          displayId: joinedUser.displayId || socket.data.displayId || null,
          username: joinedUser.username || socket.data.username || "A user",
          avatar: joinedUser.avatar || socket.data.avatar || "",
        });

        //room:seatCount
        socket.emit("room:seatCount", {
          roomId,
          seatCount: roomDoc?.seatCount || 10,
        });
        //room:lockedSeats & state
        // socket.emit("room:seats:lockedAll", {
        //   lockedSeats: roomDoc?.lockedSeats || [],
        // });
        // socket.emit("room:lockedState", {
        //   isLocked: roomDoc?.isLocked || false,
        // });
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
        const RoomMusic = require("../models/musicRoom");
        const playlist = await RoomMusic.find({ roomId }).sort({ createdAt: 1 });

        socket.emit("room:musicState", {
          roomId,
          currentTrackId: dbState?.currentTrackId ? dbState.currentTrackId.toString() : null,
          currentPosition: roomManager.getCurrentPosition(roomId),
          isPlaying: currentMusicState.isPlaying,
          startedAt: currentMusicState.startedAt,
          pausedAt: currentMusicState.pausedAt || 0,
          trackOwnerId: dbState?.trackOwnerId ? dbState.trackOwnerId.toString() : null,
          playlist: playlist.map((m) => ({
            id: m._id.toString(),
            uploaderId: m.uploadedBy.toString(),
            uploaderUsername: m.uploaderUsername || "User",
            originalName: m.originalName,
            musicUrl: m.musicUrl,
            cloudinaryPublicId: m.cloudinaryPublicId,
            duration: m.duration || 0,
            uploadedAt: m.createdAt,
          })),
          playedBy: currentMusicState.playedBy,
          musicFile: currentMusicState.musicFile,
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

        // ✅ Emit latest room details to ensure syncing
        socket.emit("room:updated", {
          room: roomDoc,
        });

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
        const userId = socket.data.userId;
        let roomId, description, senderName;

        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          roomId = data.roomId;
          description = data.description;
          senderName = data.senderName;
        } else {
          roomId = data;
          description = arg2;
        }

        if (!roomId || typeof description !== "string" || !userId) {
          return socket.emit("error", { message: "Invalid data or not authenticated" });
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

        const username = senderName || socket.data.user?.username || socket.data.username || "Host/Admin";
        const room = await Room.findOneAndUpdate(
          { roomId },
          { 
            description: cleanDesc,
            descriptionUpdatedBy: username,
          },
          { new: true },
        );

        if (!room) return;

        // ✅ already correct (with roomId)
        io.to(`room:${roomId}`).emit("room:description", {
          roomId,
          description: room.description,
          updatedBy: room.descriptionUpdatedBy || "",
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

        // ✅ Check and end PK if user was in PK
        await checkAndEndPKOnUserLeave(roomId, userId, io);

        // ✅ PREVENT DOUBLE CLEANUP
        if (socket.data.hasLeftRoom) return;

        socket.data.hasLeftRoom = true;

        deafenStates.delete(userId.toString());
        micStates.delete(userId.toString());
        micStates.delete(userId);

        const room = await Room.findOne({ roomId });

        if (!room) return;

        // =========================
        // REMOVE FROM SEATS (preserve positions)
        // =========================
        const roomSeats = seats.get(roomId) || [];
        const normalizedSeats = roomSeats.map((id) => (id ? id.toString() : null));
        const leaveIndex = normalizedSeats.indexOf(userId.toString());
        if (leaveIndex >= 0) {
          normalizedSeats[leaveIndex] = null;
          seats.set(roomId, normalizedSeats);
          io.to(`room:${roomId}`).emit("room:seat:removed", {
            userId,
            displayId: socket.data.displayId || socket.data.user?.displayId || null,
            seatNumber: leaveIndex + 1,
          });
        }

        // =========================
        // REMOVE PARTICIPANT & UPDATE ROOM USERS
        // =========================
        console.log(`[DEBUG LEAVE] userId=${userId}, hostId=${room.host}, participants before filter:`, room.participants.map(p => ({ user: p.user?.toString(), role: p.role })));
        room.participants = room.participants.filter(
          (p) => p.user && p.user.toString() !== userId.toString(),
        );
        room.currentUsers = room.participants.length;
        console.log(`[DEBUG LEAVE] participants after filter:`, room.participants.map(p => ({ user: p.user?.toString(), role: p.role })), `currentUsers=${room.currentUsers}`);

        if (roomUsers.has(roomId)) {
          roomUsers.get(roomId).delete(userId.toString());
        }

        room.lastActivityAt = new Date();

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
            // ✅ Only mark room as host_left if NO other users remain
            if (room.currentUsers <= 0) {
              room.status = "host_left";
              room.isActive = false;
            }
            // else: room stays active — other users are still inside
          }

          // 📢 Inform room that host left (NOT a kick — just a notification)
          io.to(`room:${roomId}`).emit("room:hostLeft", {
            roomId,
            hostLeft: true,
            usersRemaining: room.currentUsers,
          });

          console.log(`🚨 Host left room ${roomId}. Remaining users: ${room.currentUsers}`);
        }

        // =========================
        // EMPTY ROOM (KEPT ACTIVE PER USER REQUEST)
        // =========================
        if (room.currentUsers <= 0) {
          // Keep room active but clear participants list
          room.status = "active";
          room.isActive = true;
          room.participants = [];
          room.currentUsers = 0;
          await room.save();

          await VideoRoom.updateOne(
            { roomId },
            { $set: { participants: [], "video.isPlaying": false } }
          );

          seats.delete(roomId);
          roomUsers.delete(roomId);
          typingUsers.delete(roomId);

          await socket.leave(`room:${roomId}`);
          
          // 🔥 Tell global feed watchers that the room is now empty so it disappears instantly
          io.emit("room:updated", {
            roomId: room.roomId,
            participantCount: 0,
            seatCount: 0,
            isActive: true,
          });
          
          console.log("ℹ️ Room kept active on leave:", roomId);
          return;
        }

        // =========================
        // SAVE ROOM
        // =========================
        await room.save();

        backgroundUsers.delete(userId.toString());

        const roomName = `room:${roomId}`;
        const userSocketIds = getUserSocketIds(userId);
        if (userSocketIds.length) {
          for (const ts of userSocketIds) {
            const s = io.sockets.sockets.get(ts);
            if (s) {
              await s.leave(roomName);
            }
          }
        }
        await socket.leave(roomName);

        // Notify other room participants that the user left
        io.to(roomName).emit("room:userLeft", {
          userId,
          displayId: socket.data.displayId || socket.data.user?.displayId || null,
          username: socket.data.username || socket.data.user?.username || null,
        });
        await broadcastRoomUsers(roomId, userId);
        await broadcastWatcherCount(roomId, io, userId);

        socket.data.isBackground = false;

        console.log("🔴 User left room:", userId);
      } catch (err) {
        console.error("❌ room:leave error:", err);
      }
    });
    // ===============================
    // 🚪 ROOM:CLOSE (Host closes room)
    // ===============================
    socket.on("room:close", async ({ roomId }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId) return;

        const room = await Room.findOne({ roomId });
        if (!room) return;

        // ✅ Only the host can close the room
        if (!room.host || room.host.toString() !== userId.toString()) {
          console.log(`⚠️ Non-host ${userId} tried to close room ${roomId}`);
          return;
        }

        console.log(`🚪 Host ${userId} closing room ${roomId}`);

        // ✅ Deactivate room in DB
        room.isActive = false;
        room.status = "closed";
        room.participants = [];
        room.currentUsers = 0;
        room.endedAt = new Date();
        await room.save();

        // ✅ End active PK if running
        if (room.activePK) {
          await PKBattle.findByIdAndUpdate(room.activePK, {
            status: "ended",
            endedAt: new Date(),
          });
        }

        // ✅ Clean up VideoRoom
        await VideoRoom.updateOne(
          { roomId },
          { $set: { participants: [], "video.isPlaying": false } }
        );

        // ✅ Clean up in-memory state
        seats.delete(roomId);
        roomUsers.delete(roomId);
        typingUsers.delete(roomId);

        // ✅ Notify all room participants that the room is closed
        io.to(`room:${roomId}`).emit("room:closed", { roomId });

        // ✅ Make all sockets leave the room channel
        const socketsInRoom = await io.in(`room:${roomId}`).fetchSockets();
        for (const s of socketsInRoom) {
          await s.leave(`room:${roomId}`);
        }

        console.log(`✅ Room ${roomId} closed successfully by host ${userId}`);
      } catch (err) {
        console.error("❌ room:close error:", err);
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

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) {
          return socket.emit("pk:error", {
            message: "Only host or admin can start PK",
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
      console.log("🗳️ Socket pk:vote event received:", { roomId, pkId, toUserId });
      try {
        const userId = socket.data.userId;
        if (!userId) {
          console.warn("⚠️ pk:vote rejected: userId is missing on socket.data");
          return;
        }
        if (!roomId || !pkId || !toUserId) {
          console.warn("⚠️ pk:vote rejected: missing fields in payload", { roomId, pkId, toUserId });
          return;
        }

        const pk = await PKBattle.findById(pkId);
        if (!pk) {
          console.warn(`⚠️ pk:vote rejected: PK battle ${pkId} not found`);
          return;
        }
        if (pk.status !== "running") {
          console.warn(`⚠️ pk:vote rejected: PK battle status is ${pk.status}, not running`);
          return;
        }
        if (pk.mode !== "votes" && pk.mode !== "points") {
          console.warn(`⚠️ pk:vote rejected: PK mode is ${pk.mode}, not votes or points`);
          return;
        }

        // Check if user already voted in this PK match
        if (pk.voters && pk.voters.some(id => id.toString() === userId.toString())) {
          console.warn(`⚠️ pk:vote rejected: User ${userId} already voted in PK ${pkId}`);
          return socket.emit("pk:error", { message: "You have already voted in this PK battle" });
        }

        if (pk.leftUser.userId.toString() === toUserId.toString()) {
          pk.leftUser.score += 1;
        } else if (pk.rightUser.userId.toString() === toUserId.toString()) {
          pk.rightUser.score += 1;
        } else {
          console.warn(`⚠️ pk:vote rejected: toUserId ${toUserId} does not match leftUser ${pk.leftUser.userId} or rightUser ${pk.rightUser.userId}`);
          return;
        }

        // Add to voters list
        if (!pk.voters) pk.voters = [];
        pk.voters.push(userId);

        await pk.save();
        console.log(`✅ Vote recorded for ${toUserId} in PK ${pkId}. Scores: L=${pk.leftUser.score}, R=${pk.rightUser.score}`);

        io.to(`room:${roomId}`).emit("pk:update", {
          pkId: pk._id,
          leftScore: pk.leftUser.score,
          rightScore: pk.rightUser.score,
          voters: pk.voters, // Broadcast updated voters list
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

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) {
          return socket.emit("error:permission", {
            message: "Only host/admin can update room avatar",
          });
        }

        // Update the room's profile picture field
        room.creatorAvatar = avatar;

        // Proactively remove the host's entry from roomProfiles to clean up any legacy incorrect mappings
        if (room.roomProfiles) {
          try {
            room.roomProfiles.pull({ userId: userId });
          } catch (_) {}

          room.roomProfiles = room.roomProfiles.filter(
            (p) => p && p.userId && p.userId.toString() !== userId.toString()
          );
          room.markModified("roomProfiles");
        }

        await room.save();

        // ✅ Broadcast update
        io.to(`room:${roomId}`).emit("room:avatar:updated", {
          userId: userId.toString(),
          displayId: socket.data.displayId,
          avatar,
        });

        // ✅ Broadcast room update to sync room metadata live
        io.to(`room:${roomId}`).emit("room:updated", {
          room: room,
        });

        // ✅ Broadcast updated users list to refresh avatars in real-time
        await broadcastRoomUsers(roomId);

        console.log("✅ Room avatar updated:", { roomId, userId: userId.toString(), avatar });
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

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) {
          return socket.emit("pk:error", {
            message: "Only host or admin can end PK",
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

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) {
          return socket.emit("pk:error", {
            message: "Only host or admin can force end PK",
          });
        }

        await endPKInternal(pkId, io);
      } catch (err) {
        console.error("❌ pk:forceEnd error:", err);
      }
    });
    // ===============================
    // 🔽 LEAVE SEAT (GO TO AUDIENCES)
    // ===============================
    socket.on("room:leaveSeat", async ({ roomId }) => {
      const userId = socket.data.userId?.toString();
      if (!userId || !roomId) return;

      console.log("🪑 Leaving seat:", userId);

      // ✅ Check and end PK if user was in PK
      await checkAndEndPKOnUserLeave(roomId, userId, io);

      // ✅ FORCE REMOVE FROM SEATS (preserve positions)
      let roomSeats = seats.get(roomId) || [];
      const normalized = roomSeats.map((id) => (id ? id.toString() : null));
      const idx = normalized.indexOf(userId);
      if (idx >= 0) normalized[idx] = null;
      seats.set(roomId, normalized);

      // ✅ UPDATE USER STATE
      socket.data.isWatcher = true;
      micStates.set(userId, { muted: true, speaking: false });

      // 🔥 BROADCAST FULL STATE
      await broadcastRoomUsers(roomId);

      // 🔥 EXTRA: FORCE REMOVE EVENT (UI SAFETY)
      io.to(`room:${roomId}`).emit("room:seat:removed", {
        userId,
        displayId: socket.data.displayId || socket.data.user?.displayId || null,
        seatNumber: idx >= 0 ? idx + 1 : null,
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
        const room = await Room.findOne({ roomId }).select("host admins lockedSeats mutedSeats seatCount").lean();
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

        // ✅ GET CURRENT SEATS (fixed positions array)
        let roomSeats = seats.get(roomId);
        const seatCount = room.seatCount || 10;
        if (!Array.isArray(roomSeats) || roomSeats.length === 0) {
          roomSeats = new Array(seatCount).fill(null);
        } else if (roomSeats.length < seatCount) {
          // expand to seatCount preserving existing values
          const expanded = new Array(seatCount).fill(null);
          for (let i = 0; i < roomSeats.length; i++) {
            expanded[i] = roomSeats[i] ? roomSeats[i].toString() : null;
          }
          roomSeats = expanded;
        } else {
          roomSeats = roomSeats.map((id) => (id ? id.toString() : null));
        }

        const lockedSeatsList = room.lockedSeats || [];

        // Determine target index (0-based)
        let targetIndex = null;
        if (seatNumber !== undefined && seatNumber !== null) {
          targetIndex = Number(seatNumber) - 1;
        } else if (seatIndex !== undefined && seatIndex !== null) {
          targetIndex = Number(seatIndex);
        } else {
          // find first available seat
          targetIndex = roomSeats.findIndex((id) => !id);
        }

        // If no free seat
        if (targetIndex === -1 || targetIndex === null) {
          socket.emit("error", { message: "No seats available" });
          return;
        }

        // Permission/lock checks for non-host/admin users
        if (!isHostOrAdminUser) {
          if (lockedSeatsList.includes(targetIndex + 1) || (lockedSeatsList.length >= seatCount && targetIndex >= 0)) {
            console.log(`❌ Blocked user ${userId} from locked seat ${targetIndex + 1}`);
            io.to(`room:${roomId}`).emit("room:seat:removed", {
              userId,
              displayId: socket.data.displayId || socket.data.user?.displayId || null,
              seatNumber: targetIndex + 1,
            });
            await broadcastRoomUsers(roomId);
            socket.emit("error", { message: "This seat is locked" });
            socket.emit("error:permission", { message: "This seat is locked" });
            socket.emit("room:error", { message: "This seat is locked" });
            return;
          }
        }

        // If target occupied by someone else, deny
        if (roomSeats[targetIndex] && roomSeats[targetIndex] !== userId) {
          socket.emit("error", { message: "Seat already occupied" });
          return;
        }

        // Remove user from any previous seat position
        roomSeats = roomSeats.map((id) => (id && id.toString() === userId.toString() ? null : id));

        // ✅ UPDATE USER STATE
        socket.data.isWatcher = false;
        const isSeatMuted = room.mutedSeats && room.mutedSeats.includes(targetIndex + 1);
        micStates.set(userId, { muted: true, speaking: false });
        if (isSeatMuted) {
          socket.emit("mic:forceMuted");
        }

        // Place user at target index
        roomSeats[targetIndex] = userId;

        seats.set(roomId, roomSeats);

        // ✅ BROADCAST FULL STATE
        await broadcastRoomUsers(roomId);

        // ✅ OPTIONAL (UI trigger)
        io.to(`room:${roomId}`).emit("room:seat:taken", {
          userId,
          displayId: socket.data.displayId || socket.data.user?.displayId || null,
          username: socket.data.username || socket.data.user?.username || "A user",
          avatar: socket.data.avatar || socket.data.user?.avatar || null,
          seatNumber: targetIndex + 1,
          seatIndex: targetIndex,
        });

        console.log("✅ Seat taken synced:", userId, "seat:", targetIndex + 1);
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

    socket.on("mic:unmute", async () => {
      if (socket.data.isWatcher) return;
      const { userId, roomId } = socket.data;
      if (!userId || !roomId) return;

      // Block unmuting if user is force-muted by host/admin
      try {
        const forceMutedSet = forceMutedUsers.get(roomId);
        if (forceMutedSet && forceMutedSet.has(userId)) {
          socket.emit("mic:forceMuted");
          return;
        }
      } catch (err) {
        console.error("❌ mic:unmute force-mute check error:", err);
      }

      // Block unmuting if user is occupying a muted seat
      try {
        const roomSeats = seats.get(roomId) || [];
        const seatIndex = roomSeats.findIndex((id) => id && id.toString() === userId.toString());
        if (seatIndex !== -1) {
          const room = await getRoomSafe(roomId);
          if (room && room.mutedSeats && room.mutedSeats.includes(seatIndex + 1)) {
            socket.emit("mic:forceMuted");
            return;
          }
        }
      } catch (err) {
        console.error("❌ mic:unmute check error:", err);
      }

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
    VOICE WEBRTC SIGNALING
    ========================= */

    // call:offer / voice:offer
    socket.on("call:offer", ({ to, offer }) => {
      if (!to || !offer) return;
      const targetSocketIds = getUserSocketIds(to);
      targetSocketIds.forEach((ts) => {
        io.to(ts).emit("call:offer", {
          from: socket.data.userId,
          offer,
        });
      });
    });

    socket.on("voice:offer", ({ targetUserId, offer }) => {
      if (!targetUserId || !offer) return;
      const targetSocketIds = getUserSocketIds(targetUserId);
      targetSocketIds.forEach((ts) => {
        io.to(ts).emit("voice:offer", {
          fromUserId: socket.data.userId,
          offer,
        });
      });
    });

    // call:answer / voice:answer
    socket.on("call:answer", ({ to, answer }) => {
      if (!to || !answer) return;
      const targetSocketIds = getUserSocketIds(to);
      targetSocketIds.forEach((ts) => {
        io.to(ts).emit("call:answer", {
          from: socket.data.userId,
          answer,
        });
      });
    });

    socket.on("voice:answer", ({ targetUserId, answer }) => {
      if (!targetUserId || !answer) return;
      const targetSocketIds = getUserSocketIds(targetUserId);
      targetSocketIds.forEach((ts) => {
        io.to(ts).emit("voice:answer", {
          fromUserId: socket.data.userId,
          answer,
        });
      });
    });

    // call:ice / voice:ice
    socket.on("call:ice", ({ to, candidate }) => {
      if (!to || !candidate) return;
      const targetSocketIds = getUserSocketIds(to);
      targetSocketIds.forEach((ts) => {
        io.to(ts).emit("call:ice", {
          from: socket.data.userId,
          candidate,
        });
      });
    });

    socket.on("voice:ice", ({ targetUserId, candidate }) => {
      if (!targetUserId || !candidate) return;
      const targetSocketIds = getUserSocketIds(targetUserId);
      targetSocketIds.forEach((ts) => {
        io.to(ts).emit("voice:ice", {
          fromUserId: socket.data.userId,
          candidate,
        });
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

        try {
          const TempLog = mongoose.models.TempLog || mongoose.model("TempLog", new mongoose.Schema({ error: String, timestamp: Date }, { strict: false }));
          await TempLog.create({ 
            error: `ℹ️ Reached room:invite! roomId: ${roomId}, inviterId: ${inviterId}, invitedUsers: ${JSON.stringify(invitedUsers)}`, 
            timestamp: new Date() 
          });
        } catch (logErr) {
          console.error("❌ TempLog failed:", logErr);
        }

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
        for (const targetUserId of invitedUsers) {
          const targetStr = targetUserId.toString();
          
          // 1. Emit socket invite event
          io.to(targetStr).emit("room:invite:received", {
            inviteId: invite._id,
            roomId,
            roomTitle: invite.roomTitle,
            roomImage: invite.roomImage,
            hostName: invite.hostName,
            hostAvatar: invite.hostAvatar,
          });

          // 2. Prevent messaging self
          if (targetStr === inviterId.toString()) continue;

          try {
            // Get or create conversation between inviter and targetUser
            const sorted = [inviterId.toString(), targetStr].sort();
            const hash = sorted.join("_");

            let conversation = await Conversation.findOne({
              participantsHash: hash,
              isActive: true,
            });

            if (!conversation) {
              conversation = await Conversation.create({
                participants: sorted,
                participantsHash: hash,
              });
            }

            // Create special invitation private message
            const inviteText = `I invited you to join my audio room! [ROOM_INVITATION:${roomId}|${room.title || "Live Room"}|${room.backgroundImage || ""}|${inviter.username || "Host"}|${inviter.profile?.avatar || ""}|${inviter.displayId || ""}]`;
            
            const message = await PrivateMessage.create({
              conversationId: conversation._id,
              sender: inviterId,
              recipient: targetUserId,
              text: inviteText,
              attachment: null,
            });

            // Update conversation details
            conversation.lastMessage = message._id;
            conversation.lastMessageTime = new Date();
            await conversation.save();

            // Populate sender & recipient for private chat receiver
            await message.populate([
              { path: "sender", select: "username profile.avatar" },
              { path: "recipient", select: "username profile.avatar" },
            ]);

            // Broadcast new message to private conversation room so it shows up in real-time
            io.to(`private:${conversation._id}`).emit(
              "private:message:receive",
              message,
            );

            // Create notification for mobile / notification list
            const notif = await Notification.create({
              user: targetUserId,
              type: "message",
              title: "New Room Invitation",
              body: `${inviter.username} invited you to join their audio room!`,
              data: {
                conversationId: conversation._id,
                senderId: inviterId,
              },
            });

            io.to(`notify:${targetStr}`).emit(
              "notification:new",
              notif,
            );
          } catch (chatErr) {
            console.error("⚠️ Failed to send room invitation via 1v1 private chat:", chatErr);
            try {
              const TempLog = mongoose.models.TempLog || mongoose.model("TempLog", new mongoose.Schema({ error: String, timestamp: Date }, { strict: false }));
              await TempLog.create({ error: chatErr.stack || chatErr.message || String(chatErr), timestamp: new Date() });
            } catch (dbLogErr) {
              console.error("❌ Failed to write temp log:", dbLogErr);
            }
            socket.emit("invite:error", {
              message: `Failed to send to DM: ${chatErr.message || chatErr}`
            });
          }
        }

        socket.emit("room:invite:success", {
          success: true,
        });
      } catch (err) {
        console.error("❌ room invite error:", err);
      }
    });
    socket.on("room:seat:invite", async ({ roomId, targetUserId, seatIndex }) => {
      try {
        const inviterId = socket.data.userId;
        const inviterUsername = socket.data.username;
        if (!inviterId || !targetUserId || !roomId) return;

        console.log(`📩 seat:invite received for room ${roomId} from ${inviterUsername} targeting ${targetUserId} on seat index ${seatIndex}`);

        const targetSocketIds = getUserSocketIds(targetUserId);
        console.log(`🔌 Active socket IDs for user ${targetUserId}:`, targetSocketIds);
        targetSocketIds.forEach((ts) => {
          io.to(ts).emit("room:seat:invite:received", {
            roomId,
            inviterId,
            inviterName: inviterUsername || "Host",
            targetUserId: targetUserId,
            seatIndex,
          });
        });
      } catch (err) {
        console.error("❌ room:seat:invite error:", err);
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
            muted: true,
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
        console.log(`🔍 [Socket room:members] Request for roomId: ${roomId}`);
        if (!roomId) return socket.emit("room:members:response", { success: false, message: "Missing roomId" });

        const roomDoc = await Room.findOne({ roomId }).lean();
        if (!roomDoc) {
          console.log(`⚠️ [Socket room:members] Room not found for: ${roomId}`);
          return socket.emit("room:members:response", { success: true, members: [] });
        }

        console.log(`🏠 [Socket room:members] Room found. Database _id: ${roomDoc._id}`);

        // Convert roomDoc._id to clean mongoose ObjectId for reliable lookup in recentRooms array
        const roomObjectId = new mongoose.Types.ObjectId(roomDoc._id.toString());

        // 1. Find all users who joined (saved) this room
        const joinedUsers = await User.find({ recentRooms: roomObjectId })
          .select("_id username displayId profile.avatar profile.frame profile.bubble country gender age level")
          .lean();
        
        console.log(`👥 [Socket room:members] Found ${joinedUsers.length} users with this room in recentRooms`);

        // 2. Combine joinedUsers in a Map
        const userMap = new Map();
        for (const u of joinedUsers) {
          userMap.set(u._id.toString(), u);
        }

        // 3. Ensure host is included
        if (roomDoc.host) {
          const hostId = roomDoc.host.toString();
          if (!userMap.has(hostId)) {
            const hostUser = await User.findById(roomDoc.host)
              .select("_id username displayId profile.avatar profile.frame profile.bubble country gender age level")
              .lean();
            if (hostUser) {
              userMap.set(hostId, hostUser);
            }
          }
        }

        const adminsSet = new Set((roomDoc.admins || []).map(id => id.toString()));
        const members = Array.from(userMap.values()).map((u) => {
          const uid = u._id.toString();
          const p = (roomDoc.participants || []).find((p) => p.user && p.user.toString() === uid) || {};
          let role = p.role || "listener";
          if (roomDoc.host?.toString() === uid) {
            role = "host";
          } else if (adminsSet.has(uid)) {
            role = "admin";
          }
          return {
            userId: uid,
            username: u.username || null,
            displayId: u.displayId || null,
            avatar: u.profile?.avatar || p.avatar || null,
            frame: u.profile?.frame?.icon || null,
            bubble: u.profile?.bubble || null,
            role: role,
            joinedAt: p.joinedAt || null,
          };
        });

        console.log(`✅ [Socket room:members] Returning ${members.length} total members to client`);
        socket.emit("room:members:response", { success: true, members });
      } catch (err) {
        console.error("❌ room:members error:", err);
        socket.emit("room:members:response", { success: false, message: "Server error" });
      }
    });

    // LOCK SEAT (HOST ONLY) - Single seat lock
    socket.on("room:seat:lock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId || !seatNumber) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can lock seats" });

      const room = await getRoomSafe(roomId);
      if (!room) {
        return socket.emit("error", { message: "Room not found" });
      }

      const numSeat = Number(seatNumber);
      if (!room.lockedSeats) {
        room.lockedSeats = [];
      }

      if (!room.lockedSeats.includes(numSeat)) {
        room.lockedSeats.push(numSeat);
        await room.save();
      }

      // NOTE: Do NOT kick users from other seats when locking a single seat.
      // Locking a specific seat should not affect occupants of other seats.
      io.to(`room:${roomId}`).emit("room:seat:locked", { seatNumber: numSeat });
      io.to(`room:${roomId}`).emit("room:seats:lockedAll", { lockedSeats: room.lockedSeats });
    });

    // UNLOCK SEAT (HOST ONLY) - Single seat unlock
    socket.on("room:seat:unlock", async ({ roomId, seatNumber }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId || !seatNumber) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can unlock seats" });

      const room = await getRoomSafe(roomId);
      if (!room) {
        return socket.emit("error", { message: "Room not found" });
      }

      const numSeat = Number(seatNumber);
      if (room.lockedSeats) {
        room.lockedSeats = room.lockedSeats.filter((s) => Number(s) !== numSeat);
        await room.save();
      }

      io.to(`room:${roomId}`).emit("room:seat:unlocked", { seatNumber: numSeat });
      io.to(`room:${roomId}`).emit("room:seats:lockedAll", { lockedSeats: room.lockedSeats || [] });
    });

    // MUTE SEAT (HOST/ADMIN ONLY)
    socket.on("room:seat:mute", async ({ roomId, seatNumber }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId || !seatNumber) return;

        const allowed = await isHostOrAdmin(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can mute seats" });

        const room = await getRoomSafe(roomId);
        if (!room) return socket.emit("error", { message: "Room not found" });

        const numSeat = Number(seatNumber);
        if (!room.mutedSeats) {
          room.mutedSeats = [];
        }

        if (!room.mutedSeats.includes(numSeat)) {
          room.mutedSeats.push(numSeat);
          await room.save();
        }

        io.to(`room:${roomId}`).emit("room:seat:muted", { seatNumber: numSeat });
        io.to(`room:${roomId}`).emit("room:seats:mutedAll", { mutedSeats: room.mutedSeats });

        // Force mute the user currently occupying this seat
        const roomSeats = seats.get(roomId) || [];
        const targetUserId = roomSeats[numSeat - 1];
        if (targetUserId) {
          micStates.set(targetUserId.toString(), { muted: true, speaking: false });
          io.to(`room:${roomId}`).emit("mic:update", {
            userId: targetUserId.toString(),
            displayId: null,
            muted: true,
            speaking: false,
          });
          const targetSocket = onlineUsers.get(targetUserId.toString());
          if (targetSocket) {
            io.to(targetSocket).emit("mic:forceMuted");
          }
        }
      } catch (err) {
        console.error("❌ room:seat:mute error:", err);
      }
    });

    // UNMUTE SEAT (HOST/ADMIN ONLY)
    socket.on("room:seat:unmute", async ({ roomId, seatNumber }) => {
      try {
        const userId = socket.data.userId;
        if (!userId || !roomId || !seatNumber) return;

        const allowed = await isHost(roomId, userId);
        if (!allowed) return socket.emit("error:permission", { message: "Only host can unmute seats" });

        const room = await getRoomSafe(roomId);
        if (!room) return socket.emit("error", { message: "Room not found" });

        const numSeat = Number(seatNumber);
        if (room.mutedSeats) {
          room.mutedSeats = room.mutedSeats.filter((s) => Number(s) !== numSeat);
          await room.save();
        }

        io.to(`room:${roomId}`).emit("room:seat:unmuted", { seatNumber: numSeat });
        io.to(`room:${roomId}`).emit("room:seats:mutedAll", { mutedSeats: room.mutedSeats || [] });
      } catch (err) {
        console.error("❌ room:seat:unmute error:", err);
      }
    });

    // MIC OFF (Force mute one user - HOST/ADMIN ONLY)
    socket.on("room:mic:forceOff", async (payload) => {
      const roomId = payload.roomId;
      const targetUserId = (payload.targetUserId || payload.userId)?.toString();
      const userId = socket.data.userId;
      if (!userId || !roomId || !targetUserId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can force mute" });

      micStates.set(targetUserId, { muted: true, speaking: false });

      io.to(`room:${roomId}`).emit("mic:update", {
        userId: targetUserId,
        displayId: null,
        muted: true,
        speaking: false,
      });

      // Emit to all user's sockets via their private room (userId.toString())
      io.to(targetUserId).emit("mic:forceMuted");

      // Track force-muted user
      if (!forceMutedUsers.has(roomId)) {
        forceMutedUsers.set(roomId, new Set());
      }
      forceMutedUsers.get(roomId).add(targetUserId);
    });

    // FORCE UNMUTE ONE USER (HOST/ADMIN ONLY)
    socket.on("room:mic:forceUnmute", async (payload) => {
      const roomId = payload.roomId;
      const targetUserId = (payload.targetUserId || payload.userId)?.toString();
      const userId = socket.data.userId;
      if (!userId || !roomId || !targetUserId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can force unmute" });

      // Remove from force-muted tracking
      const forceMutedSet = forceMutedUsers.get(roomId);
      if (forceMutedSet) {
        forceMutedSet.delete(targetUserId);
      }

      micStates.set(targetUserId, { muted: false, speaking: false });

      io.to(`room:${roomId}`).emit("mic:update", {
        userId: targetUserId,
        displayId: null,
        muted: false,
        speaking: false,
      });

      // Emit to all user's sockets via their private room (userId.toString())
      io.to(targetUserId).emit("mic:forceUnmuted");
    });

    // MUTE EVERYONE (HOST ONLY)
    socket.on("room:mic:muteAll", async ({ roomId }) => {
      const userId = socket.data.userId;
      if (!userId || !roomId) return;

      const allowed = await isHostOrAdmin(roomId, userId);
      if (!allowed) return socket.emit("error:permission", { message: "Only host/admin can mute all" });

      const sockets = await io.in(`room:${roomId}`).fetchSockets();

      sockets.forEach((s) => {
        const uid = s.data.userId;
        if (!uid) return;
        micStates.set(uid, { muted: true, speaking: false });
      });

      io.to(`room:${roomId}`).emit("room:mic:mutedAll");
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
        const normalized = roomSeats.map((id) => (id ? id.toString() : null));
        const idx = normalized.indexOf(targetUserId.toString());
        if (idx >= 0) normalized[idx] = null;
        seats.set(roomId, normalized);
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

        const targetUser = await User.findById(targetUserId).lean();
        const targetDisplayId = targetUser?.displayId || null;

        const room = await Room.findOne({ roomId });
        if (room) {
          if (!room.kickedUsers) room.kickedUsers = [];
          room.kickedUsers.push({ userId: targetUserId, kickedAt: new Date() });
          room.participants = room.participants.filter(
            (p) => p.user && p.user.toString() !== targetUserId.toString()
          );
          room.currentUsers = room.participants.length;
          await room.save();
        }

        // ✅ CLEAN SERVER MEMORY FOR KICKED USER
        if (roomUsers.has(roomId)) roomUsers.get(roomId).delete(targetUserId.toString());
        if (typingUsers.has(roomId)) typingUsers.get(roomId).delete(targetUserId.toString());
        backgroundUsers.delete(targetUserId.toString());

        // ✅ REMOVE FROM SEATS (preserve positions)
        let roomSeats = seats.get(roomId) || [];
        const normalized = roomSeats.map((id) => (id ? id.toString() : null));
        const idx = normalized.indexOf(targetUserId.toString());
        if (idx >= 0) {
          normalized[idx] = null;
          seats.set(roomId, normalized);
          io.to(`room:${roomId}`).emit("room:seat:removed", {
            userId: targetUserId.toString(),
            displayId: targetDisplayId,
            seatNumber: idx + 1,
          });
        }

        // ✅ FORCE ALL SOCKETS OF KICKED USER IN THIS ROOM TO LEAVE
        const roomSockets = await io.in(`room:${roomId}`).fetchSockets();
        for (const s of roomSockets) {
          if (s.data.userId && s.data.userId.toString() === targetUserId.toString()) {
            io.to(s.id).emit("room:kicked", { roomId, message: "You have been kicked from the room" });
            s.data.hasLeftRoom = true;
            await s.leave(`room:${roomId}`);
            s.data.roomId = null;
          }
        }

        const targetSocketIds = getUserSocketIds(targetUserId);
        if (targetSocketIds.length) {
          for (const ts of targetSocketIds) {
            io.to(ts).emit("room:kicked", { roomId, message: "You have been kicked from the room" });
            const targetSocket = io.sockets.sockets.get(ts);
            if (targetSocket) {
              targetSocket.data.hasLeftRoom = true;
              await targetSocket.leave(`room:${roomId}`);
              targetSocket.data.roomId = null;
            }
          }
        }

        io.to(`room:${roomId}`).emit("room:userLeft", {
          userId: targetUserId.toString(),
          displayId: targetDisplayId,
        });

        deafenStates.delete(targetUserId.toString());
        micStates.delete(targetUserId.toString());
        micStates.delete(targetUserId);

        // Broadcast updated users list
        await broadcastRoomUsers(roomId, targetUserId);
        await broadcastWatcherCount(roomId, io, targetUserId);

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

        const targetUser = await User.findById(targetUserId).lean();
        const targetDisplayId = targetUser?.displayId || null;

        const room = await Room.findOne({ roomId });
        if (room) {
          if (!room.blockedUsers) room.blockedUsers = [];
          if (!room.blockedUsers.some(id => id.toString() === targetUserId.toString())) {
            room.blockedUsers.push(new mongoose.Types.ObjectId(targetUserId));
          }
          room.participants = room.participants.filter(
            (p) => p.user && p.user.toString() !== targetUserId.toString()
          );
          room.currentUsers = room.participants.length;
          await room.save();
        }

        // ✅ CLEAN SERVER MEMORY
        if (roomUsers.has(roomId)) roomUsers.get(roomId).delete(targetUserId.toString());
        if (typingUsers.has(roomId)) typingUsers.get(roomId).delete(targetUserId.toString());
        backgroundUsers.delete(targetUserId.toString());

        // ✅ REMOVE FROM SEATS (preserve positions)
        let roomSeats = seats.get(roomId) || [];
        const normalized = roomSeats.map((id) => (id ? id.toString() : null));
        const idx = normalized.indexOf(targetUserId.toString());
        if (idx >= 0) {
          normalized[idx] = null;
          seats.set(roomId, normalized);
          io.to(`room:${roomId}`).emit("room:seat:removed", {
            userId: targetUserId.toString(),
            displayId: targetDisplayId,
            seatNumber: idx + 1,
          });
        }

        // ✅ FORCE ALL SOCKETS OF BLOCKED USER IN THIS ROOM TO LEAVE
        const roomSockets = await io.in(`room:${roomId}`).fetchSockets();
        for (const s of roomSockets) {
          if (s.data.userId && s.data.userId.toString() === targetUserId.toString()) {
            io.to(s.id).emit("room:blocked", { roomId, message: "You have been blocked from this room" });
            s.data.hasLeftRoom = true;
            await s.leave(`room:${roomId}`);
            s.data.roomId = null;
          }
        }

        const targetSocketIds = getUserSocketIds(targetUserId);
        if (targetSocketIds.length) {
          for (const ts of targetSocketIds) {
            io.to(ts).emit("room:blocked", { roomId, message: "You have been blocked from this room" });
            const targetSocket = io.sockets.sockets.get(ts);
            if (targetSocket) {
              targetSocket.data.hasLeftRoom = true;
              await targetSocket.leave(`room:${roomId}`);
              targetSocket.data.roomId = null;
            }
          }
        }

        io.to(`room:${roomId}`).emit("room:userLeft", {
          userId: targetUserId.toString(),
          displayId: targetDisplayId,
        });

        deafenStates.delete(targetUserId.toString());
        micStates.delete(targetUserId.toString());
        micStates.delete(targetUserId);

        // Broadcast updated users list
        await broadcastRoomUsers(roomId, targetUserId);
        await broadcastWatcherCount(roomId, io, targetUserId);

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
       EMOJI REACTIONS
    ========================= */
    socket.on("send_emoji", (payload) => {
      try {
        const { roomId, userId, emoji } = payload || {};
        if (!roomId || !userId || !emoji) return;

        // Broadcast to all other users in the room
        socket.to(`room:${roomId}`).emit("receive_emoji", {
          userId,
          emoji,
        });

        console.log(`😂 Emoji sent by ${userId} in room ${roomId}: ${emoji}`);
      } catch (err) {
        console.error("❌ send_emoji error:", err);
      }
    });

    /* =========================
       DISCONNECT
    ========================= */
    socket.on("disconnect", async () => {
      const { roomId, userId } = socket.data;
      if (socket.data.hasLeftRoom) return;

      console.log(`❌ Socket disconnected: ${socket.id} (user: ${userId}, room: ${roomId})`);

      if (userId && roomId) {
        await checkAndEndPKOnUserLeave(roomId, userId, io);
      }

      if (userId) {
        removeUserSocket(userId, socket.id);
      }

      const remainingSockets = userId ? getUserSocketIds(userId) : [];

      // Find remaining sockets for this user *in this specific room* (excluding current socket)
      const roomSockets = roomId ? await io.in(`room:${roomId}`).fetchSockets() : [];
      const remainingSocketsInRoom = roomSockets.filter(
        (s) => s.id !== socket.id && s.data.userId?.toString() === userId?.toString()
      );

      // If the user has no remaining active socket connections in this room, clean up their room presence
      if (userId && roomId && remainingSocketsInRoom.length === 0) {
        // Remove from seats map (preserve positions; set vacated slot to null)
        const roomSeats = seats.get(roomId) || [];
        const normalizedSeats = roomSeats.map((id) => (id ? id.toString() : null));
        const removeIdx = normalizedSeats.indexOf(userId.toString());
        if (removeIdx >= 0) {
          normalizedSeats[removeIdx] = null;
          seats.set(roomId, normalizedSeats);
          io.to(`room:${roomId}`).emit("room:seat:removed", {
            userId,
            displayId: socket.data.displayId || socket.data.user?.displayId || null,
            seatNumber: removeIdx + 1,
          });
        }

        // Remove from typing and room users sets
        if (typingUsers.has(roomId)) {
          typingUsers.get(roomId).delete(userId.toString());
        }
        if (roomUsers.has(roomId)) {
          roomUsers.get(roomId).delete(userId.toString());
        }

        // Clean up database room presence
        const room = await Room.findOne({ roomId });
        if (room) {
          // Remove from participants & update room users
          console.log(`[DEBUG DISCONNECT] userId=${userId}, hostId=${room.host}, participants before filter:`, room.participants.map(p => ({ user: p.user?.toString(), role: p.role })));
          room.participants = room.participants.filter(
            (p) => p.user && p.user.toString() !== userId.toString(),
          );
          room.currentUsers = room.participants.length;
          console.log(`[DEBUG DISCONNECT] participants after filter:`, room.participants.map(p => ({ user: p.user?.toString(), role: p.role })), `currentUsers=${room.currentUsers}`);
          room.lastActivityAt = new Date();

          // Remove from VideoRoom participants
          await VideoRoom.updateOne(
            { roomId },
            { $pull: { participants: { userId } } }
          );

          // Grace-Period Host Disconnection
          if (room.host && room.host.toString() === userId.toString()) {
            room.hostOnline = false;
            room.hostLeftAt = new Date();
            await room.save();

            // 📢 Inform room that host disconnected (NOT a kick)
            io.to(`room:${roomId}`).emit("room:hostLeft", {
              roomId,
              hostLeft: true,
              usersRemaining: room.currentUsers,
            });

            if (!room.isHelpRoom) {
              // Keep room active on host disconnect
              room.status = "active";
              room.isActive = true;
              await room.save();
              console.log(`ℹ️ Host disconnected. Room ${roomId} kept active.`);
            }
          }

          // Grace-Period Room Cleanup (KEPT ACTIVE PER USER REQUEST)
          if (room.currentUsers <= 0) {
            // Keep all rooms active but clear participants list
            room.status = "active";
            room.isActive = true;
            room.participants = [];
            room.currentUsers = 0;
            await room.save();

            await VideoRoom.updateOne(
              { roomId },
              { $set: { participants: [], "video.isPlaying": false } }
            );

            seats.delete(roomId);
            roomUsers.delete(roomId);
            typingUsers.delete(roomId);
            
            // 🔥 Tell global feed watchers that the room is now empty so it disappears instantly
            io.emit("room:updated", {
              roomId: room.roomId,
              participantCount: 0,
              seatCount: 0,
              isActive: true,
            });
            
            console.log("ℹ️ Room kept active on disconnect:", roomId);
          }

          await room.save();
        }

        // DJ Left stops music
        const musicState = roomManager.getState(roomId);
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

        // Notify other room participants
        const roomName = `room:${roomId}`;
        io.to(roomName).emit("room:userLeft", {
          userId,
          displayId: socket.data.displayId || socket.data.user?.displayId || null,
        });
        await broadcastRoomUsers(roomId, userId);
        await broadcastWatcherCount(roomId, io, userId);
      }

      // If the user has no remaining active socket connections globally, clean up global states
      if (userId && remainingSockets.length === 0) {
        // Clean up user specific in-memory states
        onlineUsers.delete(userId);
        micStates.delete(userId);
        deafenStates.delete(userId.toString());
        User.findByIdAndUpdate(userId, { lastSeen: new Date() }).catch(e => console.error("Error updating lastSeen on disconnect:", e));

        if (roomStayTimers.has(userId)) {
          clearInterval(roomStayTimers.get(userId));
          roomStayTimers.delete(userId);
        }
        if (micExpTimers.has(userId)) {
          clearInterval(micExpTimers.get(userId));
          micExpTimers.delete(userId);
        }
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
module.exports.endPKInternal = endPKInternal;
