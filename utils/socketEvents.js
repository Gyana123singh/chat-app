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

const mongoose = require("mongoose");

async function distributePKRewards(pk, roomId, io) {
  try {
    if (!pk?._id) return;

    const fresh = await PKBattle.findById(pk._id);
    if (!fresh || fresh.rewardsDistributed) return;

    fresh.rewardsDistributed = true;
    await fresh.save();

    const WIN_REWARD = 100;
    const LOSE_REWARD = 20;
    const DRAW_REWARD = 50;

    if (fresh.winner) {
      const winnerId = fresh.winner?.toString();
      const leftId = fresh.leftUser.userId?.toString();
      const rightId = fresh.rightUser.userId?.toString();
      const loserId = winnerId === leftId ? rightId : leftId;

      if (winnerId) {
        await User.findByIdAndUpdate(winnerId, {
          $inc: { coins: WIN_REWARD, totalEarned: WIN_REWARD },
        });
        io.to(winnerId).emit("coins:update:inc", { coins: WIN_REWARD });
      }

      if (loserId) {
        await User.findByIdAndUpdate(loserId, {
          $inc: { coins: LOSE_REWARD, totalEarned: LOSE_REWARD },
        });
        io.to(loserId).emit("coins:update:inc", { coins: LOSE_REWARD });
      }
    } else {
      const leftId = fresh.leftUser.userId?.toString();
      const rightId = fresh.rightUser.userId?.toString();

      if (leftId) {
        await User.findByIdAndUpdate(leftId, {
          $inc: { coins: DRAW_REWARD, totalEarned: DRAW_REWARD },
        });
        io.to(leftId).emit("coins:update:inc", { coins: DRAW_REWARD });
      }

      if (rightId) {
        await User.findByIdAndUpdate(rightId, {
          $inc: { coins: DRAW_REWARD, totalEarned: DRAW_REWARD },
        });
        io.to(rightId).emit("coins:update:inc", { coins: DRAW_REWARD });
      }
    }

    io.to(`room:${roomId}`).emit("pk:rewards:distributed", {
      pkId: fresh._id,
    });
  } catch (err) {
    console.error("❌ PK reward distribution error:", err.message);
  }
}

module.exports = (io) => {
  const onlineUsers = new Map();
  const micStates = new Map(); // userId -> { muted, speaking }
  const roomMessages = new Map(); // roomId -> [messages]
  const typingUsers = new Map(); // roomId -> Set of userIds typing
  const roomUsers = new Map(); // roomId -> Set of userIds in room
  const pkTimers = new Map(); // pkId -> timeoutId

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

          // =========================
          // 🎯 ADD EXP FOR GIFT SEND (WAFA STYLE)
          // =========================
          const giftExp = Math.floor(totalCoins / 25); // 25 coins = 1 EXP (tweak if needed)

          if (giftExp > 0) {
            await levelController.addPersonalExp(senderId, giftExp, io);

            io.to(senderId.toString()).emit("level:exp", {
              type: "personal",
              exp: giftExp,
              message: `+${giftExp} EXP (Gift sent)`,
            });

            // Optional: also add ROOM EXP
            const roomExp = Math.floor(totalCoins / 10);
            if (roomExp > 0) {
              await levelController.addRoomExp(senderId, roomExp, io);

              io.to(senderId.toString()).emit("level:exp", {
                type: "room",
                exp: roomExp,
                message: `+${roomExp} Room EXP (Gift sent)`,
              });
            }
          }

          // 🏆 Update Trophy / Leaderboard (AFTER COMMIT ONLY)
          const {
            updateLeaderboardOnGift,
          } = require("../controllers/trophyController"); // adjust path

          // totalCoins already computed as: gift.price * qty * recipients.length
          updateLeaderboardOnGift(senderId, totalCoins).catch((e) =>
            console.error("Trophy update failed:", e.message),
          );

          // 🎬 BROADCAST GIFT ANIMATION
          io.to(roomName).emit("gift:animation", {
            sender: {
              id: sender._id,
              username: sender.username,
              avatar: sender.profile?.avatar || null,
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

    // =========================
    // 🆚 PK START (HOST ONLY)
    // =========================
    socket.on("pk:start", async ({ roomId, pkId }) => {
      try {
        const pk = await PKBattle.findById(pkId);
        if (!pk) return;

        const room = await Room.findOne({ roomId }).select("host");
        if (!room) return;

        // ✅ Only host can start PK
        if (
          !socket.data.userId ||
          room.host.toString() !== socket.data.userId.toString()
        ) {
          console.log("❌ Non-host tried to start PK");
          return;
        }

        // ❌ If already running, ignore
        if (pk.status === "running") return;

        pk.status = "running";
        pk.startedAt = new Date();
        await pk.save();

        await Room.findOneAndUpdate({ roomId }, { $set: { activePK: pk._id } });

        io.to(`room:${roomId}`).emit("pk:started", {
          pkId: pk._id,
          leftUser: pk.leftUser,
          rightUser: pk.rightUser,
          mode: pk.mode,
          duration: pk.duration,
          startedAt: pk.startedAt,
        });

        // ⛔ Clear old timer if exists
        if (pkTimers.has(pkId)) {
          clearTimeout(pkTimers.get(pkId));
          pkTimers.delete(pkId);
        }

        // ⏱ Auto end PK (SINGLE TIMER)
        const timer = setTimeout(async () => {
          const freshPK = await PKBattle.findById(pkId);
          if (!freshPK || freshPK.status !== "running") return;

          freshPK.status = "ended";
          freshPK.endedAt = new Date();

          if (freshPK.leftUser.score > freshPK.rightUser.score) {
            freshPK.winner = freshPK.leftUser.userId;
          } else if (freshPK.rightUser.score > freshPK.leftUser.score) {
            freshPK.winner = freshPK.rightUser.userId;
          } else {
            freshPK.winner = null;
          }

          await freshPK.save();
          await Room.findOneAndUpdate({ roomId }, { $set: { activePK: null } });

          await distributePKRewards(freshPK, roomId, io);

          io.to(`room:${roomId}`).emit("pk:ended", {
            pkId: freshPK._id,
            winner: freshPK.winner,
            leftScore: freshPK.leftUser.score,
            rightScore: freshPK.rightUser.score,
          });

          // 🧹 Clean timer
          pkTimers.delete(pkId);
        }, pk.duration * 1000);

        // ✅ Store timer
        pkTimers.set(pkId, timer);
      } catch (err) {
        console.error("❌ pk:start error:", err);
      }
    });

    // =========================
    // 🔴 PK STOP (HOST ONLY)
    // =========================
    socket.on("pk:stop", async ({ roomId, pkId }) => {
      try {
        const pk = await PKBattle.findById(pkId);
        if (!pk || pk.status !== "running") return;

        const room = await Room.findOne({ roomId }).select("host");
        if (!room) return;

        // Only host
        if (room.host.toString() !== socket.data.userId.toString()) return;

        pk.status = "ended";
        pk.endedAt = new Date();

        // Decide winner
        if (pk.leftUser.score > pk.rightUser.score) {
          pk.winner = pk.leftUser.userId;
        } else if (pk.rightUser.score > pk.leftUser.score) {
          pk.winner = pk.rightUser.userId;
        } else {
          pk.winner = null; // draw
        }
        if (pkTimers.has(pkId)) {
          clearTimeout(pkTimers.get(pkId));
          pkTimers.delete(pkId);
        }

        await pk.save();

        // Clear room activePK
        await Room.findOneAndUpdate({ roomId }, { $set: { activePK: null } });

        // 🏆 Distribute rewards
        await distributePKRewards(pk, roomId, io);

        io.to(`room:${roomId}`).emit("pk:ended", {
          pkId: pk._id,
          winner: pk.winner,
          leftScore: pk.leftUser.score,
          rightScore: pk.rightUser.score,
          reason: "stopped_by_host",
        });
      } catch (err) {
        console.error("❌ pk:stop error:", err);
      }
    });
    // =========================
    // 🔁 PK RESTART (HOST ONLY)
    // =========================
    socket.on("pk:restart", async ({ roomId, pkId }) => {
      try {
        const pk = await PKBattle.findById(pkId);
        if (!pk) return;

        const room = await Room.findOne({ roomId }).select("host");
        if (!room) return;

        // Only host
        if (room.host.toString() !== socket.data.userId.toString()) return;

        // ⛔ Clear old timer if exists
        if (pkTimers.has(pkId)) {
          clearTimeout(pkTimers.get(pkId));
          pkTimers.delete(pkId);
        }

        // Reset scores & state
        pk.leftUser.score = 0;
        pk.rightUser.score = 0;
        pk.status = "running";
        pk.startedAt = new Date();
        pk.endedAt = null;
        pk.winner = null;
        pk.contributions = [];
        pk.rewardsDistributed = false; // ✅ IMPORTANT

        await pk.save();

        io.to(`room:${roomId}`).emit("pk:restarted", {
          pkId: pk._id,
          leftUser: pk.leftUser,
          rightUser: pk.rightUser,
          mode: pk.mode,
          duration: pk.duration,
          startedAt: pk.startedAt,
        });

        // ⏱ Auto end again (SINGLE TIMER)
        const timer = setTimeout(async () => {
          const freshPK = await PKBattle.findById(pkId);
          if (!freshPK || freshPK.status !== "running") return;

          freshPK.status = "ended";
          freshPK.endedAt = new Date();

          if (freshPK.leftUser.score > freshPK.rightUser.score) {
            freshPK.winner = freshPK.leftUser.userId;
          } else if (freshPK.rightUser.score > freshPK.leftUser.score) {
            freshPK.winner = freshPK.rightUser.userId;
          } else {
            freshPK.winner = null;
          }

          await freshPK.save();
          await Room.findOneAndUpdate({ roomId }, { $set: { activePK: null } });

          await distributePKRewards(freshPK, roomId, io);

          io.to(`room:${roomId}`).emit("pk:ended", {
            pkId: freshPK._id,
            winner: freshPK.winner,
            leftScore: freshPK.leftUser.score,
            rightScore: freshPK.rightUser.score,
            reason: "timer_end",
          });

          // 🧹 Clean timer
          pkTimers.delete(pkId);
        }, pk.duration * 1000);

        // ✅ Store timer
        pkTimers.set(pkId, timer);
      } catch (err) {
        console.error("❌ pk:restart error:", err);
      }
    });

    // =========================
    // 🆚 PK GIFT SEND (SEPARATE & SAFE)
    // =========================
    socket.on(
      "pk:gift:send",
      async ({ roomId, pkId, giftId, toUserId, quantity = 1 }) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          const senderId = socket.data.userId;
          if (senderId.toString() === toUserId.toString()) {
            await session.abortTransaction();
            socket.emit("pk:gift:error", {
              message: "You cannot gift yourself",
            });
            return;
          }

          if (!senderId || !roomId || !pkId || !giftId || !toUserId) {
            await session.abortTransaction();
            return;
          }

          // 🔎 Validate PK
          const pk = await PKBattle.findById(pkId).session(session);
          if (!pk || pk.status !== "running") {
            await session.abortTransaction();
            socket.emit("pk:gift:error", { message: "PK not active" });
            return;
          }
          const room = await Room.findOne({ roomId })
            .select("activePK")
            .session(session);
          if (!room || room.activePK?.toString() !== pkId.toString()) {
            await session.abortTransaction();
            socket.emit("pk:gift:error", {
              message: "This PK is not active in room",
            });
            return;
          }

          // 🎁 Validate Gift
          const gift = await Gift.findOne({
            _id: giftId,
            isAvailable: true,
          }).session(session);

          if (!gift) {
            await session.abortTransaction();
            socket.emit("pk:gift:error", { message: "Gift not found" });
            return;
          }

          // 🔢 Quantity limit
          const qty = Math.max(1, Math.min(Number(quantity), 499));

          // 💰 Total cost (PK gift is for ONE target user)
          const totalCoins = gift.price * qty;

          // 🔥 Deduct coins atomically
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

          if (!sender) {
            await session.abortTransaction();
            const balance = await User.findById(senderId).select("coins");
            socket.emit("pk:gift:recharge", {
              requiredCoins: totalCoins,
              currentCoins: balance?.coins || 0,
            });
            return;
          }

          // 🧾 Save Gift Transaction (PK tagged)
          await GiftTransaction.create(
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
                sendType: "pk",
                quantity: qty,
                recipientCount: 1,
                recipientIds: [toUserId],
                totalCoinsDeducted: totalCoins,
                status: "completed",
                meta: { pkId },
              },
            ],
            { session },
          );

          // 💳 Wallet transaction
          await Transaction.create(
            [
              {
                userId: senderId,
                type: "COIN_SPENT",
                transactionType: "pk_gift",
                gift: gift._id,
                giftName: gift.name,
                coinsUsed: totalCoins,
                sender: senderId,
                room: roomId,
                paymentMethod: "gift",
                status: "SUCCESS",
                completedAt: new Date(),
                message: `Sent PK gift ${gift.name} x${qty}`,
              },
            ],
            { session },
          );
          // =========================
          // 🧮 UPDATE PK SCORE
          // =========================
          let scoreAdd = totalCoins;
          if (pk.mode === "votes") scoreAdd = 1;

          const leftId = pk.leftUser.userId?.toString();
          const rightId = pk.rightUser.userId?.toString();

          if (toUserId.toString() === leftId) {
            pk.leftUser.score += scoreAdd;
          } else if (toUserId.toString() === rightId) {
            pk.rightUser.score += scoreAdd;
          } else {
            await session.abortTransaction();
            socket.emit("pk:gift:error", { message: "Target not in PK" });
            return;
          }

          pk.contributions.push({
            fromUser: senderId,
            toUser: toUserId,
            giftId,
            value: scoreAdd,
          });

          await pk.save({ session });

          await session.commitTransaction();
          // =========================
          // 🎯 ADD EXP FOR PK GIFT SEND
          // =========================
          const giftExp = Math.floor(totalCoins / 25);

          if (giftExp > 0) {
            await levelController.addPersonalExp(senderId, giftExp, io);

            io.to(senderId.toString()).emit("level:exp", {
              type: "personal",
              exp: giftExp,
              message: `+${giftExp} EXP (PK Gift sent)`,
            });
          }

          // =========================
          // 📢 EMITS
          // =========================

          // 🎬 Optional: show gift animation in room
          io.to(`room:${roomId}`).emit("gift:animation", {
            sender: {
              id: sender._id,
              username: sender.username,
              avatar: sender.profile?.avatar || null,
            },
            gift: {
              id: gift._id,
              name: gift.name,
              icon: gift.icon,
              rarity: gift.rarity,
              effectType: gift.effectType,
              animationUrl: gift.animationUrl,
            },
            recipients: [toUserId],
            quantity: qty,
            totalCoinsDeducted: totalCoins,
            count: 1,
            sendType: "pk",
          });

          // 🔴 PK score update
          io.to(`room:${roomId}`).emit("pk:score:update", {
            pkId: pk._id,
            leftScore: pk.leftUser.score,
            rightScore: pk.rightUser.score,
          });

          // 💰 Sender wallet update
          io.to(senderId.toString()).emit("coins:update", {
            coins: sender.coins,
          });
        } catch (err) {
          await session.abortTransaction();
          console.error("❌ PK gift send error:", err);
          socket.emit("pk:gift:error", {
            message: "Failed to send PK gift",
          });
        } finally {
          session.endSession();
        }
      },
    );

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

  return {
    getMicStates: () => micStates,
    getRoomUsers: () => roomUsers,
    getOnlineUsers: () => onlineUsers,
    getRoomManager: () => roomManager,
  };
};
