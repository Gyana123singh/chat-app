const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");

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

const MusicState = require("./models/musicState");

const app = express();
connectMongose();

/* ===================== 🔥 RESET MUSIC STATE ON SERVER START ===================== */
(async () => {
  try {
    await MusicState.updateMany(
      {},
      {
        isPlaying: false,
        pausedAt: 0,
        startedAt: null,
        musicFile: null,
        musicUrl: null,
        localFilePath: null,
        playedBy: null,
      }
    );

    console.log("🧹 All music states reset on server start");
  } catch (err) {
    console.error("❌ Failed to reset music states:", err);
  }
})();
/* =============================================================================== */

const PORT = process.env.PORT || 5001;

/* ===================== MIDDLEWARE ===================== */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.use(
  session({
    secret: "secret123",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());

/* ===================== ROUTES (BEFORE io) ===================== */

app.use("/auth", authRoutes);
app.use("/api", adminRoutes);
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

app.get("/", (req, res) => {
  res.send("API is running...");
});

/* ===================== SOCKET + MUSIC ROUTES ===================== */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 100 * 1024 * 1024,
  transports: ["websocket", "polling"],
});
app.set("io", io); // <----- ADD THIS LINE
// ✅ CREATE UPLOADS ROOT FOLDER
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("📁 Created uploads directory:", uploadDir);
}

// ✅ MUSIC ROUTES
const musicRouter = require("./router/musicRouter")(io);
app.use("/api/music", musicRouter);

/* ===================== AUDIO STREAM ROUTE ===================== */

app.get("/stream/:roomId/:filename", (req, res) => {
  const filePath = path.join(
    __dirname,
    "..",
    "uploads",
    req.params.roomId,
    req.params.filename
  );

  if (!fs.existsSync(filePath)) {
    console.log("❌ File not found:", filePath);
    return res.status(404).end();
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "audio/mpeg",
    });

    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "audio/mpeg",
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

/* ===================== VIDEO ROUTES ===================== */

const videoRouter = require("./router/videoRouter")(io);
app.use("/api/video", videoRouter);

/* ===================== VIDEO STREAM ROUTE ===================== */

app.get("/video-stream/:roomId/:filename", (req, res) => {
  const filePath = path.join(
    __dirname,
    "..",
    "uploads",
    "videos",
    req.params.roomId,
    req.params.filename
  );

  if (!fs.existsSync(filePath)) {
    console.log("❌ Video file not found:", filePath);
    return res.status(404).end();
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });

    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);
require("./utils/giftSocketEvents")(io);
require("./utils/socketEventPrivateChat")(io);

global.io = io;
console.log("🚀 Socket.IO + Music Streaming initialized successfully");

/* ===================== CRON ===================== */

const cron = require("./utils/cron");
let cronInstance = null;

/* ===================== START SERVER ===================== */

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready on port ${PORT}`);
  console.log(`🎵 Music streaming ready: http://localhost:${PORT}/stream/...`);

  cronInstance = cron;
  cronInstance.startCronJobs();
  console.log("🕐 Cron jobs initialized ✅");
});

module.exports = { app, io, server };

/* ===================== GRACEFUL SHUTDOWN ===================== */

const gracefulShutdown = (signal) => {
  console.log(`🛑 Received ${signal}. Shutting down gracefully...`);

  if (cronInstance && cronInstance.stopCronJobs) {
    cronInstance.stopCronJobs();
    console.log("🛑 All cron jobs stopped");
  }

  server.close((err) => {
    if (err) {
      console.error("❌ Server close error:", err);
      process.exit(1);
    }
    console.log("✅ Server closed cleanly");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("⚠️ Force closing server after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("SIGQUIT", gracefulShutdown);
