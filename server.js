const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");
const mime = require("mime-types");

dotenv.config();
require("./config/passport");

const { connectMongose } = require("./config/mongoDb");
const authRoutes = require("./router/authRouter");
const adminRoutes = require("./router/adminRouter");
const usersRouter = require("./router/usersRouter");
const roomsRouter = require("./router/roomsRouter");
const firebaseOtpRouter = require("./router/authFirebaseRouter");
const giftRouter = require("./router/giftsRouter");
const friendRequestRouter = require("./router/friendRequestRouter");
const blockUsersRouter = require("./router/blockUsersRouter");
const profileVisitRouter = require("./router/profileVisitRouter");
const paymentRouter = require("./router/paymentRouter");
const storeGiftRouter = require("./router/storeGiftRouter");
const sendStoreGiftRoutes = require("./router/sendStoreGiftRoutes");
const privateChatRouter = require("./router/privateChatRouter");
const trophyRouter = require("./router/trophyRouter");
const levelRouter = require("./router/levelRouter");
const notificationRouter = require("./router/notificationRouter");
const promotionRouter = require("./router/promotionRouter");
const cpRouter = require("./router/cpRoutes");
const pkRoutes = require("./router/pkRouter");
const roomInviteRouter = require("./router/roomInviteRouter");
const chatUploadRouter = require("./router/chatUploadRouter");
const privateImageUpload = require("./router/privateImageUpload");
const MusicState = require("./models/musicState");
const expireStoreGifts = require("./utils/storeGiftExpiryWorker");
const Room = require("./models/room");
const VideoRoom = require("./models/videoRoom");

const app = express();
connectMongose().then(async () => {
  try {
    const { migrateMusicData, restoreAllMusicStates } = require("./controllers/musicController");
    await migrateMusicData();
    await restoreAllMusicStates();

    // Backfill displayId for existing users
    const User = require("./models/users");
    const generateDisplayId = require("./utils/generateDisplayId");
    const usersWithoutId = await User.find({
      $or: [{ displayId: { $exists: false } }, { displayId: null }],
    });
    if (usersWithoutId.length > 0) {
      console.log(`[Backfill] Found ${usersWithoutId.length} users without displayId. Assigning...`);
      for (const u of usersWithoutId) {
        u.displayId = await generateDisplayId();
        await u.save();
      }
      console.log("[Backfill] Assigned displayId to all users successfully!");
    }
  } catch (err) {
    console.error("❌ Failed to run startup migrations/restores:", err);
  }
});
// Run every 5 minutes
setInterval(
  () => {
    expireStoreGifts();
  },
  5 * 60 * 1000,
);

const PORT = Number(process.env.PORT || 5004);

/* ===================== MIDDLEWARE ===================== */
app.use(
  cors({
    origin: true, // 👈 auto reflect frontend origin
    credentials: true,
  }),
);

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// ✅ STATIC FILES
app.use("/uploads", express.static("uploads"));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret123",
    resave: false,
    saveUninitialized: false,
  }),
);

app.use(passport.initialize());
app.use(passport.session());

/* ===================== ROUTES ===================== */
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes); // ✅ Support /api/auth/google/firebase as well
app.use("/api", adminRoutes);
app.use("/", adminRoutes); // ✅ Support /admin/login directly for admin panel without breaking /api/admin/login
app.use("/api/users", usersRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/auth/otp", firebaseOtpRouter);
app.use("/api/gift", giftRouter);
app.use("/api/friends", friendRequestRouter);
app.use("/api/block", blockUsersRouter);
app.use("/api/profile-visits", profileVisitRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/store-gifts", storeGiftRouter);
app.use("/api/store-gift-send", sendStoreGiftRoutes);
app.use("/api/private-chat", privateChatRouter);
app.use("/api/trophies", trophyRouter);
app.use("/api/level", levelRouter);
const reportRouter = require("./router/reportRouter");

app.use("/api/notifications", notificationRouter);
app.use("/api/promotion", promotionRouter);
app.use("/api/cp", cpRouter);
app.use("/api/pk", pkRoutes);
app.use("/api/room-invites", roomInviteRouter);
app.use("/api/image-upload", chatUploadRouter);
app.use("/api/reports", reportRouter);
app.use("/api/private-upload", privateImageUpload);

app.get("/", (req, res) => {
  res.send("API is running...");
});
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "API is running",
    time: new Date(),
  });
});

/* ===================== SOCKET ===================== */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 100 * 1024 * 1024,
});

app.set("io", io);

/* ===================== UPLOAD ROOT ===================== */
const uploadDir = path.resolve(process.cwd(), "uploads");
fs.ensureDirSync(uploadDir);

/* ===================== MUSIC ROUTES ===================== */
const musicRouter = require("./router/musicRouter")(io);
app.use("/api/music", musicRouter);

/* ===================== VIDEO ===================== */
const videoRouter = require("./router/videoRouter")(io);
app.use("/api/video", videoRouter);

app.get("/video-stream/:roomId/:filename", (req, res) => {
  try {
    const filePath = path.resolve(
      process.cwd(),
      "uploads",
      "videos",
      req.params.roomId,
      req.params.filename,
    );

    if (!fs.existsSync(filePath)) {
      return res.sendStatus(404);
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // ✅ Dynamic content type
    const contentType = mime.lookup(filePath) || "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");

      const start = parseInt(parts[0], 10);

      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      fs.createReadStream(filePath, {
        start,
        end,
      }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error("❌ video stream error:", err);

    res.status(500).json({
      message: "Video stream failed",
    });
  }
});

/* ===================== SOCKET EVENTS ===================== */
require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);
require("./utils/giftSocketEvents")(io);
require("./utils/socketEventPrivateChat")(io);
require("./utils/socketFriendsSuggestions")(io);

const socketService = require("./utils/socketService");
socketService.init(io);

global.io = io;

console.log("🚀 Socket.IO + Music Streaming ready");

// setInterval(
//   async () => {
//     try {
//       // Find rooms with zero users that are NOT help rooms and NOT admin-created
//       const zombieRooms = await Room.find({
//         currentUsers: 0,
//         isHelpRoom: { $ne: true },
//         createdByAdmin: { $ne: true },
//       });
// 
//       for (const room of zombieRooms) {
//         // ✅ End active PK if running
//         if (room.activePK) {
//           const PKBattle = require("./models/pkBattle");
//           await PKBattle.findByIdAndUpdate(room.activePK, {
//             status: "ended",
//             endedAt: new Date(),
//           });
//         }
// 
//         await Room.deleteOne({ roomId: room.roomId });
// 
//         await VideoRoom.deleteOne({ roomId: room.roomId });
//         await fs.remove(
//           path.resolve(process.cwd(), "uploads", "videos", room.roomId),
//         );
// 
//         await MusicState.deleteOne({ roomId: room.roomId });
//       }
//     } catch (err) {
//       console.error("❌ cleanup worker:", err.message);
//     }
//   },
//   5 * 60 * 1000,
// );

/* ===================== CRON ===================== */
const cron = require("./utils/cron");
let cronInstance = null;

/* ===================== START ===================== */
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  cronInstance = cron;
  cronInstance.startCronJobs();
});

/* ===================== SHUTDOWN ===================== */

process.isShuttingDown = false;

const gracefulShutdown = () => {
  if (process.isShuttingDown) return;
  process.isShuttingDown = true;

  console.log("🛑 Gracefully shutting down...");

  if (cronInstance?.stopCronJobs) {
    cronInstance.stopCronJobs();
  }

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000);
};

process.once("SIGINT", gracefulShutdown);
process.once("SIGTERM", gracefulShutdown);

module.exports = { app, io, server };
