const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra"); // ✅ NEW
const path = require("path"); // ✅ NEW

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

const app = express();
connectMongose();

const PORT = process.env.PORT || 5001;

/* ===================== MIDDLEWARE ===================== */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

/* 🔥 REQUIRED */
app.use(express.json({ limit: "100mb" })); // ✅ Increased for audio files
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

/* ===================== SOCKET + MUSIC ROUTES (AFTER HTTP SERVER) ===================== */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 100 * 1024 * 1024, // ✅ 100MB for audio
  transports: ["websocket", "polling"],
});

// ✅ CREATE UPLOADS FOLDER
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("📁 Created uploads directory");
}

// ✅ MUSIC ROUTES - NOW io IS READY
const musicRouter = require("./router/musicRouter")(io);
app.use("/api/music", musicRouter);

// ✅ AUDIO STREAMING ROUTE (CRITICAL FOR MUSIC)
app.get("/stream/:roomId/:filename", (req, res) => {
  const filePath = path.join(uploadDir, req.params.roomId, req.params.filename);

  console.log(`🎵 Streaming: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.log(`❌ File not found: ${filePath}`);
    return res.status(404).json({ error: "File not found" });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // ✅ SUPPORT SEEKING (Range requests)
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;

    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    // Full file stream
    const head = {
      "Content-Length": fileSize,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);
require("./utils/giftSocketEvents")(io);
require("./utils/socketEventPrivateChat")(io);

// ✅ Make io globally available
global.io = io;
console.log("🚀 Socket.IO + Music Streaming initialized successfully");

/* ===================== CRON IMPORT ===================== */
const cron = require("./utils/cron");
let cronInstance = null;

/* ===================== START SERVER ===================== */
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready on port ${PORT}`);
  console.log(`🎵 Music streaming ready: http://localhost:${PORT}/stream/...`);

  // ✅ START CRON JOBS
  cronInstance = cron;
  cronInstance.startCronJobs();
  console.log("🕐 Cron jobs initialized ✅");
});

module.exports = { app, io, server };

/* ===================== GRACEFUL SHUTDOWN ===================== */
const gracefulShutdown = (signal) => {
  console.log(`🛑 Received ${signal}. Shutting down gracefully...`);

  // ✅ STOP CRON JOBS FIRST
  if (cronInstance && cronInstance.stopCronJobs) {
    cronInstance.stopCronJobs();
    console.log("🛑 All cron jobs stopped");
  }

  // ✅ CLOSE SERVER
  server.close((err) => {
    if (err) {
      console.error("❌ Server close error:", err);
      process.exit(1);
    }
    console.log("✅ Server closed cleanly");
    process.exit(0);
  });

  // Force close after 10 seconds if not clean
  setTimeout(() => {
    console.error("⚠️ Force closing server after timeout");
    process.exit(1);
  }, 10000);
};

// ✅ LISTEN FOR SHUTDOWN SIGNALS
process.on("SIGINT", gracefulShutdown); // Ctrl+C
process.on("SIGTERM", gracefulShutdown); // Docker/PM2/Heroku
process.on("SIGQUIT", gracefulShutdown); // Kill -3
